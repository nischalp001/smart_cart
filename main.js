$(function () {
    // Remove the InferenceEngine initialization since we're using HTTP API now
    let detectedItems = {};
    let detectedItemPositions = {};
    let checkoutClicked = false;
    let prevTime = null;
    let pastFrameTimes = [];
    let detectionHistory = [];
    const historyLength = 10;
    const confidenceThreshold = 0.5;
    const minDetectionFrames = 3;
    const productColors = {
        "WaiWai": "#FFD700",
        "Ariel": "#2ECC40",
        "Coke": "#FF4136",
        "Dettol": "#0074D9",
        "Hajmola Rasilo Candy": "#40100e",
        "Ariel": "#25852f",
        "Parachute Coconut Oil": "#0b429c",
        "Colgate": "#9c0b4c",
        "Horlicks": "#0b9c6e",
        "Ketchup": "#800311",
        "KitKat": "#b0515c",
        "Oreo": "#0b2d54",
        "Patanjali Dish Soap": "#23b067",
        "Colin": "#4c6ad4",
        "Thai Inhaler": "#128c2d",
        "Vaseline": "#d2d918"
    };
    
    const video = document.getElementById('video');
    let canvas, ctx;
    let isProcessingFrame = false;
    const apiEndpoint = "http://192.168.10.117:5000/predict";
    
    async function initializeCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "environment",
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });
            video.srcObject = stream;
            return new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play();
                    resolve(true);
                };
            });
        } catch (error) {
            console.error('Camera initialization error:', error);
            handleCameraError(error);
            return false;
        }
    }
    
    function handleCameraError(error) {
        const errorMessage = error.name === 'NotAllowedError'
            ? 'Camera access denied. Please allow camera access to use Smart Cart.'
            : `Camera error: ${error.message}`;
        alert(errorMessage);
    }
    
    function resizeCanvas() {
        $("canvas").remove();
        canvas = $("<canvas/>");
        ctx = canvas[0].getContext("2d");
        const videoContainer = $(".video-section");
        const displayedWidth = videoContainer.width();
        const displayedHeight = videoContainer.height();
        canvas[0].width = displayedWidth;
        canvas[0].height = displayedHeight;
        canvas.css({
            position: 'absolute',
            width: "100%",
            height: "100%",
            left: 0,
            top: 0
        });
        videoContainer.append(canvas);
    }
    
    function nonMaxSuppression(predictions) {
        if (!predictions.length) return [];
        const sorted = [...predictions].sort((a, b) => b.confidence - a.confidence);
        const selected = [sorted[0]];
        
        for (let i = 1; i < sorted.length; i++) {
            let overlapping = false;
            for (const selectedPred of selected) {
                if (calculateIoU(sorted[i].bbox, selectedPred.bbox) > 0.5) {
                    overlapping = true;
                    break;
                }
            }
            if (!overlapping) {
                selected.push(sorted[i]);
            }
        }
        return selected;
    }
    
    function calculateIoU(box1, box2) {
        // Convert YOLO API format (xyxy) to center format for IoU calculation
        const box1Center = {
            x: (box1[0] + box1[2]) / 2,
            y: (box1[1] + box1[3]) / 2,
            width: box1[2] - box1[0],
            height: box1[3] - box1[1]
        };
        
        const box2Center = {
            x: (box2[0] + box2[2]) / 2,
            y: (box2[1] + box2[3]) / 2,
            width: box2[2] - box2[0],
            height: box2[3] - box2[1]
        };
        
        const box1Corner = {
            x1: box1Center.x - box1Center.width / 2,
            y1: box1Center.y - box1Center.height / 2,
            x2: box1Center.x + box1Center.width / 2,
            y2: box1Center.y + box1Center.height / 2
        };
        
        const box2Corner = {
            x1: box2Center.x - box2Center.width / 2,
            y1: box2Center.y - box2Center.height / 2,
            x2: box2Center.x + box2Center.width / 2,
            y2: box2Center.y + box2Center.height / 2
        };
        
        const xOverlap = Math.max(0, Math.min(box1Corner.x2, box2Corner.x2) - Math.max(box1Corner.x1, box2Corner.x1));
        const yOverlap = Math.max(0, Math.min(box1Corner.y2, box2Corner.y2) - Math.max(box1Corner.y1, box2Corner.y1));
        const intersectionArea = xOverlap * yOverlap;
        const box1Area = (box1Corner.x2 - box1Corner.x1) * (box1Corner.y2 - box1Corner.y1);
        const box2Area = (box2Corner.x2 - box2Corner.x1) * (box2Corner.y2 - box2Corner.y1);
        const unionArea = box1Area + box2Area - intersectionArea;
        
        return unionArea > 0 ? intersectionArea / unionArea : 0;
    }
    
    function deduplicateDetections(predictions) {
        const predictionsByClass = {};
        const uniquePredictions = {};
        
        predictions.forEach(prediction => {
            if (prediction.confidence < confidenceThreshold) return;
            const itemClass = prediction.class;
            if (!predictionsByClass[itemClass]) {
                predictionsByClass[itemClass] = [];
            }
            predictionsByClass[itemClass].push(prediction);
        });
        
        for (const [itemClass, preds] of Object.entries(predictionsByClass)) {
            const uniquePreds = nonMaxSuppression(preds);
            uniquePredictions[itemClass] = uniquePreds;
        }
        
        const result = {};
        for (const [itemClass, uniquePreds] of Object.entries(uniquePredictions)) {
            result[itemClass] = uniquePreds.length;
        }
        return { counts: result, predictions: uniquePredictions };
    }
    
    function updateCart(detectionResult) {
        const newDetections = detectionResult.counts;
        detectionHistory.push(newDetections);
        
        if (detectionHistory.length > historyLength) {
            detectionHistory.shift();
        }
        
        const itemCounts = {};
        for (const frameDets of detectionHistory) {
            for (const [item, count] of Object.entries(frameDets)) {
                if (!itemCounts[item]) {
                    itemCounts[item] = 0;
                }
                itemCounts[item]++;
            }
        }
        
        const stableItems = {};
        for (const [item, frames] of Object.entries(itemCounts)) {
            if (frames >= minDetectionFrames) {
                const counts = {};
                for (const frameDets of detectionHistory) {
                    if (frameDets[item]) {
                        if (!counts[frameDets[item]]) {
                            counts[frameDets[item]] = 0;
                        }
                        counts[frameDets[item]]++;
                    }
                }
                let maxCount = 0;
                let mostCommonQuantity = 0;
                for (const [quantity, count] of Object.entries(counts)) {
                    if (count > maxCount) {
                        maxCount = count;
                        mostCommonQuantity = parseInt(quantity);
                    }
                }
                stableItems[item] = mostCommonQuantity;
            }
        }
        
        detectedItems = stableItems;
        updateItemPositions(detectionResult.predictions);
        renderCart();
        return detectionResult.predictions;
    }
    
    function updateItemPositions(predictions) {
        detectedItemPositions = {};
        for (const [itemClass, predList] of Object.entries(predictions)) {
            if (predList.length > 0) {
                const scaleX = canvas[0].width / video.videoWidth;
                const scaleY = canvas[0].height / video.videoHeight;
                const mainPrediction = predList[0];
                const bbox = mainPrediction.bbox;
                
                // Convert YOLO bbox format [x1, y1, x2, y2] to center format
                const centerX = (bbox[0] + bbox[2]) / 2;
                const centerY = (bbox[1] + bbox[3]) / 2;
                
                detectedItemPositions[itemClass] = {
                    x: centerX * scaleX,
                    y: centerY * scaleY,
                    confidence: mainPrediction.confidence
                };
            }
        }
    }
    
    function renderCart() {
        if (checkoutClicked) return;
        const cartItems = $("#detections");
        let cartHTML = '';
        let totalPrice = 0;
        
        Object.entries(detectedItems).forEach(([item, count]) => {
            const price = itemPrices[item] * count;
            totalPrice += price;
            const itemColor = productColors[item] || '#6B7BF7';
            cartHTML += `
                <div class="cart-item" data-item="${item}" style="border-left: 4px solid ${itemColor};">
                    <span class="item-name">${item} × ${count}</span>
                    <span class="item-price">Rs. ${price}</span>
                </div>
            `;
        });
        
        if (totalPrice > 0) {
            cartHTML += `
                <div class="cart-item total">
                    <span>Total</span>
                    <span>Rs. ${totalPrice}</span>
                </div>
            `;
        }
        
        cartItems.html(cartHTML);
    }
    
    function getLocationIndicator(position) {
        if (!position) return "Not visible";
        
        const canvasWidth = canvas[0].width;
        const canvasHeight = canvas[0].height;
        let horizontalPosition, verticalPosition;
        
        if (position.x < canvasWidth * 0.33) {
            horizontalPosition = "Left";
        } else if (position.x > canvasWidth * 0.67) {
            horizontalPosition = "Right";
        } else {
            horizontalPosition = "Center";
        }
        
        if (position.y < canvasHeight * 0.33) {
            verticalPosition = "Top";
        } else if (position.y > canvasHeight * 0.67) {
            verticalPosition = "Bottom";
        } else {
            verticalPosition = "Middle";
        }
        
        return `${verticalPosition} ${horizontalPosition}`;
    }
    
    function drawConnectionLines() {
        if (checkoutClicked) return;
        const sidebar = $("#detection-sidebar");
        if (!sidebar.length) return;
        
        const sidebarRect = sidebar[0].getBoundingClientRect();
        const videoContainer = $(".video-section")[0].getBoundingClientRect();
        
        Object.entries(detectedItemPositions).forEach(([item, position]) => {
            const sidebarItem = $(`#sidebar-item-${item.replace(/\s+/g, '-').toLowerCase()}`);
            if (!sidebarItem.length) return;
            
            const itemRect = sidebarItem[0].getBoundingClientRect();
            const itemColor = productColors[item] || '#6B7BF7';
            
            const startX = itemRect.right - videoContainer.left;
            const startY = (itemRect.top + itemRect.bottom) / 2 - videoContainer.top;
            const endX = position.x;
            const endY = position.y;
            
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = itemColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            drawArrow(startX, startY, endX, endY, itemColor);
        });
    }
    
    function drawArrow(fromX, fromY, toX, toY, color) {
        const headLength = 10;
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const midX = (fromX + toX) / 2;
        const midY = (fromY + toY) / 2;
        
        ctx.beginPath();
        ctx.moveTo(midX, midY);
        ctx.lineTo(
            midX - headLength * Math.cos(angle - Math.PI / 6),
            midY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            midX - headLength * Math.cos(angle + Math.PI / 6),
            midY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.lineTo(midX, midY);
        ctx.fillStyle = color;
        ctx.fill();
    }
    
    function renderPredictions(predictions) {
        ctx.clearRect(0, 0, canvas[0].width, canvas[0].height);
        
        // Format incoming predictions from Flask API to match expected format
        const formattedPredictions = predictions.map(pred => {
            return {
                class: pred.class,
                confidence: pred.confidence,
                bbox: pred.bbox  // Already in [x1, y1, x2, y2] format from Flask API
            };
        });
        
        const detectionResult = deduplicateDetections(formattedPredictions);
        const uniquePredictions = updateCart(detectionResult);
        
        for (const [itemClass, predList] of Object.entries(uniquePredictions)) {
            const color = productColors[itemClass] || '#6B7BF7';
            
            for (const prediction of predList) {
                const bbox = prediction.bbox;
                const scaleX = ctx.canvas.width / video.videoWidth;
                const scaleY = ctx.canvas.height / video.videoHeight;
                
                // Convert YOLO bbox format [x1, y1, x2, y2] to needed values
                const x = (bbox[0] + bbox[2]) / 2 * scaleX;
                const y = (bbox[1] + bbox[3]) / 2 * scaleY;
                const width = (bbox[2] - bbox[0]) * scaleX;
                const height = (bbox[3] - bbox[1]) * scaleY;
                
                // Draw bounding box
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.strokeRect(x - width / 2, y - height / 2, width, height);
                
                // Draw label with confidence
                const confidenceText = (prediction.confidence * 100).toFixed(0) + '%';
                const labelText = `${itemClass} (${confidenceText})`;
                ctx.font = '16px sans-serif';
                const labelWidth = ctx.measureText(labelText).width + 10;
                ctx.fillStyle = color;
                ctx.fillRect(x - width / 2, y - height / 2 - 25, labelWidth, 25);
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(labelText, x - width / 2 + 5, y - height / 2 - 8);
                
                drawItemIdentifier(x, y, itemClass, color);
            }
        }
        
        drawConnectionLines();
    }
    
    function captureAndSendFrame() {
        if (checkoutClicked || !video.videoWidth || isProcessingFrame) return;
        
        isProcessingFrame = true;
        
        // Create temporary canvas to capture frame
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // Convert to blob for sending to server
        tempCanvas.toBlob(async (blob) => {
            try {
                const formData = new FormData();
                formData.append('image', blob);
                
                const response = await fetch(apiEndpoint, {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                }
                
                const predictions = await response.json();
                renderPredictions(predictions);
                
                // Calculate and display FPS
                if (prevTime) {
                    pastFrameTimes.push(Date.now() - prevTime);
                    if (pastFrameTimes.length > 60) pastFrameTimes.shift();
                    
                    let total = 0;
                    pastFrameTimes.forEach(function (t) {
                        total += t / 1000;
                    });
                    
                    const fps = pastFrameTimes.length / total;
                    $("#fps").text(Math.round(fps));
                }
                
                prevTime = Date.now();
                isProcessingFrame = false;
                
                // Continue detection loop
                requestAnimationFrame(captureAndSendFrame);
                
            } catch (error) {
                console.error("Detection error:", error);
                isProcessingFrame = false;
                requestAnimationFrame(captureAndSendFrame);
            }
        }, 'image/jpeg', 0.8);  // Medium quality JPEG for better performance
    }
    
    function drawItemIdentifier(x, y, itemClass, color) {
        const radius = 15;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        
        const initial = itemClass.charAt(0);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial, x, y);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }
    
    const itemPrices = {
        "Coke": 100,
        "Dettol": 25,
        "WaiWai": 20,
        "Ariel": 175,
        "Hajmola Rasilo Candy": 2,
        "Ariel": 520,
        "Parachute Coconut Oil": 250,
        "Colgate": 170,
        "Horlicks": 280,
        "Ketchup": 320,
        "KitKat": 20,
        "Oreo": 25,
        "Patanjali Dish Soap": 35,
        "Colin": 175,
        "Thai Inhaler": 315,
        "Vaseline": 205
    };
    
    // Function to create a receipt modal
    function createReceiptModal(items, total) {
        // Create receipt container
        const receiptModal = $(`
            <div id="receiptModal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0,0,0,0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 2000;
            ">
                <div class="receipt-content" style="
                    background-color: white;
                    width: 90%;
                    max-width: 400px;
                    border-radius: 8px;
                    padding: 20px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                ">
                    <div class="receipt-header" style="
                        text-align: center;
                        border-bottom: 2px dashed #ccc;
                        padding-bottom: 15px;
                        margin-bottom: 15px;
                    ">
                        <h2 style="margin: 0; color: #333;">किराना Cart</h2>
                        <p style="margin: 5px 0; color: #666;">Receipt</p>
                        <p style="margin: 5px 0; font-size: 12px; color: #888;">${new Date().toLocaleString()}</p>
                    </div>
                    <div class="receipt-items" style="
                        margin-bottom: 15px;
                        border-bottom: 1px dashed #ccc;
                        padding-bottom: 15px;
                    ">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="border-bottom: 1px solid #eee;">
                                    <th style="text-align: left; padding: 5px 0;">Item</th>
                                    <th style="text-align: center; padding: 5px 0;">Qty</th>
                                    <th style="text-align: right; padding: 5px 0;">Price</th>
                                    <th style="text-align: right; padding: 5px 0;">Subtotal</th>
                                </tr>
                            </thead>
                            <tbody id="receiptItems">
                                <!-- Items will be added here dynamically -->
                            </tbody>
                        </table>
                    </div>
                    <div class="receipt-total" style="
                        text-align: right;
                        margin-bottom: 20px;
                        padding-bottom: 15px;
                        border-bottom: 2px dashed #ccc;
                    ">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span>Subtotal:</span>
                            <span>Rs. ${total}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span>Tax (13%):</span>
                            <span>Rs. ${(total * 0.13).toFixed(2)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 1.2em;">
                            <span>TOTAL:</span>
                            <span>Rs. ${(total * 1.13).toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="receipt-actions" style="
                        display: flex;
                        justify-content: center;
                    ">
                        <button id="confirmReceipt" style="
                            background-color: #4CAF50;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 4px;
                            font-size: 16px;
                            cursor: pointer;
                        ">Confirm & Pay</button>
                    </div>
                </div>
            </div>
        `);
        
        // Add receipt items
        const receiptItemsContainer = receiptModal.find("#receiptItems");
        
        Object.entries(items).forEach(([item, count]) => {
            const price = itemPrices[item];
            const subtotal = price * count;
            
            receiptItemsContainer.append(`
                <tr style="border-bottom: 1px solid #f8f8f8;">
                    <td style="padding: 8px 0;">${item}</td>
                    <td style="text-align: center; padding: 8px 0;">${count}</td>
                    <td style="text-align: right; padding: 8px 0;">Rs. ${price}</td>
                    <td style="text-align: right; padding: 8px 0;">Rs. ${subtotal}</td>
                </tr>
            `);
        });
        
        // Append to body
        $("body").append(receiptModal);
        
        // Return the modal element
        return receiptModal;
    }
    
    // Function to generate a QR code for payment
    function showQRCodeScreen(amount) {
        // Create a transaction ID
        const transactionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const timestamp = new Date().toISOString();
        const paymentData = {
            amount: amount.toFixed(2),
            transactionId: transactionId,
            timestamp: timestamp,
            store: "Smart Cart Demo"
        };
        
        // Create payment QR code screen
        const qrScreen = $(`
            <div id="qrCodeScreen" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: white;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 3000;
                text-align: center;
            ">
                <h2 style="margin: 0 0 20px 0; color: #333;">Scan to Pay</h2>
                <p style="margin: 0 0 30px 0; color: #666;">Amount: Rs. ${amount.toFixed(2)}</p>
                <div id="qrcode" style="
                    background-color: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                    margin-bottom: 30px;
                ">
                    <!-- SVG QR Code placeholder with example data -->
                    <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="200" height="200" viewBox="0 0 200 200">
                        <rect x="0" y="0" width="200" height="200" fill="#FFFFFF" />
                        <g transform="scale(4)">
                            <!-- Simple placeholder QR pattern -->
                            <rect x="0" y="0" width="50" height="50" fill="#FFFFFF" />
                            <!-- QR code corner squares -->
                            <rect x="0" y="0" width="7" height="7" fill="#000000" />
                            <rect x="1" y="1" width="5" height="5" fill="#FFFFFF" />
                            <rect x="2" y="2" width="3" height="3" fill="#000000" />
                            
                            <rect x="43" y="0" width="7" height="7" fill="#000000" />
                            <rect x="44" y="1" width="5" height="5" fill="#FFFFFF" />
                            <rect x="45" y="2" width="3" height="3" fill="#000000" />
                            
                            <rect x="0" y="43" width="7" height="7" fill="#000000" />
                            <rect x="1" y="44" width="5" height="5" fill="#FFFFFF" />
                            <rect x="2" y="45" width="3" height="3" fill="#000000" />
                            
                            <!-- Random QR code bits for visual effect -->
                            <rect x="10" y="10" width="2" height="2" fill="#000000" />
                            <rect x="14" y="10" width="2" height="2" fill="#000000" />
                            <rect x="18" y="12" width="2" height="2" fill="#000000" />
                            <rect x="22" y="8" width="2" height="2" fill="#000000" />
                            <rect x="26" y="15" width="2" height="2" fill="#000000" />
                            <rect x="30" y="20" width="2" height="2" fill="#000000" />
                            <rect x="34" y="25" width="2" height="2" fill="#000000" />
                            <rect x="38" y="30" width="2" height="2" fill="#000000" />
                            <rect x="10" y="35" width="2" height="2" fill="#000000" />
                            <rect x="15" y="40" width="2" height="2" fill="#000000" />
                            <rect x="20" y="30" width="2" height="2" fill="#000000" />
                            <rect x="25" y="25" width="2" height="2" fill="#000000" />
                            <rect x="30" y="35" width="2" height="2" fill="#000000" />
                        </g>
                    </svg>
                </div>
                <p style="margin: 0 0 10px 0; color: #888;">Transaction ID: ${transactionId}</p>
                <button id="completePayment" style="
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 25px;
                    border-radius: 5px;
                    font-size: 16px;
                    cursor: pointer;
                    margin-top: 20px;
                ">Complete Payment</button>
            </div>
        `);
        
        // Append to body
        $("body").append(qrScreen);
        
        // Add event listener for payment completion
        qrScreen.find("#completePayment").click(function() {
            qrScreen.fadeOut(300, function() {
                qrScreen.remove();
                
                // Show thank you message
                const thankYouScreen = $(`
                    <div style="
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background-color: white;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        z-index: 3000;
                        text-align: center;
                    ">
                        <h1 style="color: #4CAF50; margin-bottom: 20px;">Thank You!</h1>
                        <p style="font-size: 18px; margin-bottom: 30px;">Your payment has been processed successfully.</p>
                        <div style="margin-bottom: 30px;">
                            <svg width="80" height="80" viewBox="0 0 24 24">
                                <circle cx="12" cy="12" r="11" fill="#4CAF50" stroke="none"/>
                                <path d="M7 13l3 3 7-7" stroke="#fff" stroke-width="2" fill="none"/>
                            </svg>
                        </div>
                        <p style="color: #666; margin-bottom: 30px;">Receipt has been sent to your email.</p>
                        <button id="returnToShopping" style="
                            background-color: #2196F3;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 4px;
                            font-size: 16px;
                            cursor: pointer;
                        ">Return to Shopping</button>
                    </div>
                `);
                
                $("body").append(thankYouScreen);
                
                thankYouScreen.find("#returnToShopping").click(function() {
                    window.location.reload();
                });
            });
        });
    }
    
    $('#checkoutButton').click(function() {
        if (Object.keys(detectedItems).length === 0) {
            alert('No items detected in cart!');
            return;
        }
        
        checkoutClicked = true;
        $(this).prop('disabled', true);
        $(this).html('<i class="fas fa-spinner fa-spin"></i> Processing...');
        $("#detection-sidebar").fadeOut();
        
        let total = 0;
        for (let item in detectedItems) {
            total += itemPrices[item] * detectedItems[item];
        }
        
        // Show the receipt modal instead of alert
        setTimeout(() => {
            // Create and show receipt
            const receiptModal = createReceiptModal(detectedItems, total);
            
            // Add event listener for receipt confirmation
            receiptModal.find("#confirmReceipt").click(function() {
                // Hide receipt modal
                receiptModal.fadeOut(300, function() {
                    receiptModal.remove();
                    // Show QR code for payment
                    showQRCodeScreen(total * 1.13); // Total with tax
                });
            });
        }, 1000);
    });
    
    function createStatusIndicator() {
        const statusDiv = $('<div id="detectionStatus" style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; border-radius: 5px; z-index: 1000;">Initializing...</div>');
        $(".video-section").append(statusDiv);
        return statusDiv;
    }
    
    function createInstructions() {
        const instructions = $(`
            <div id="instructions" style="
                position: absolute;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                text-align: center;
                font-size: 14px;
                z-index: 90;
                max-width: 80%;
            ">
                <p style="margin: 0 0 5px 0;"><b>How to use:</b> Point camera at products to detect them</p>
                <p style="margin: 0;">Item locations shown on left sidebar with directional indicators</p>
                <button id="hideInstructions" style="
                    background: #555;
                    border: none;
                    color: white;
                    padding: 4px 10px;
                    border-radius: 3px;
                    margin-top: 8px;
                    cursor: pointer;
                ">Got it</button>
            </div>
        `);
        
        $(".video-section").append(instructions);
        
        $("#hideInstructions").click(function() {
            $(this).parent().fadeOut();
        });
    }
    
    // Add styling for the receipt
    function addReceiptStyles() {
        const receiptStyles = $(`
            <style>
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    #receiptModal, #receiptModal * {
                        visibility: visible;
                    }
                    #receiptModal {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                    }
                    #receiptModal .receipt-actions {
                        display: none !important;
                    }
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                #receiptModal .receipt-content {
                    animation: fadeIn 0.5s ease-out;
                }
                
                #qrCodeScreen {
                    animation: fadeIn 0.5s ease-out;
                }
            </style>
        `);
        
        $("head").append(receiptStyles);
    }
    
    // Test connection to API server
    async function testApiConnection() {
        try {
            const response = await fetch(apiEndpoint.replace('/predict', '/'));
            if (!response.ok) {
                throw new Error(`API server not responding: ${response.status}`);
            }
            return true;
        } catch (error) {
            console.error('API connection test failed:', error);
            return false;
        }
    }
    
    async function initialize() {
        const statusIndicator = createStatusIndicator();
        
        // Add receipt styles
        addReceiptStyles();
        
        try {
            statusIndicator.text("Initializing camera...");
            const cameraInitialized = await initializeCamera();
            
            if (!cameraInitialized) {
                statusIndicator.css("background", "rgba(255,0,0,0.7)").text("Camera initialization failed");
                return;
            }
            
            statusIndicator.text("Connecting to detection server...");
            const apiConnected = await testApiConnection();
            
            if (!apiConnected) {
                statusIndicator.css("background", "rgba(255,0,0,0.7)")
                    .text("Cannot connect to detection server at " + apiEndpoint);
                return;
            }
            
            statusIndicator.text("Starting detection...");
            resizeCanvas();
            
            createInstructions();
            
            setTimeout(() => {
                statusIndicator.css("background", "rgba(0,128,0,0.7)").text("Ready! Point camera at products");
                setTimeout(() => {
                    statusIndicator.fadeOut(1000);
                }, 3000);
                captureAndSendFrame();
            }, 1000);
        } catch (error) {
            console.error('Initialization error:', error);
            statusIndicator.css("background", "rgba(255,0,0,0.7)").text("Error: " + error.message);
        }
    }
    
    initialize().catch(error => {
        console.error('Global initialization error:', error);
        alert("Failed to initialize application: " + error.message);
    });
    
    $(window).resize(function() {
        resizeCanvas();
    });
});