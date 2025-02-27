$(function () {
    const { InferenceEngine, CVImage } = inferencejs;
    let inferEngine;
    let workerId;
    let detectedItems = {};
    let detectedItemPositions = {};
    let checkoutClicked = false;
    let prevTime = null;
    let pastFrameTimes = [];

    let detectionHistory = [];
    const historyLength = 10;
    const confidenceThreshold = 0.5; // Lowered confidence threshold for better detection
    const minDetectionFrames = 3;

    const productColors = {
        "WaiWai": "#d4d400",
        "Ariel": "#19ff00",
        "Coke": "#ff0f0f",
        "Dettol": "#009d1b",
        "Colgate": "#fd21ff",
        "Oreo": "#004d90",
        "Colin": "#00ffeb",
        "Harpic": "#0071fc",
        "Patanjali Dish Soap": "#8cff00",
        "Ketchup": "#f98181",



    };

    const video = document.getElementById('video');
    let canvas, ctx;

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

    async function initializeInference() {
        try {
            inferEngine = new InferenceEngine();
            workerId = await inferEngine.startWorker(
                "smart_cart-mio9y-7gylq",
                "1",
                "rf_DN8H3uI2eigUk7P0QjdfOGGzdjO2"
            );
            console.log('Inference engine initialized with worker ID:', workerId);
            return true;
        } catch (error) {
            console.error('Inference initialization error:', error);
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
        const box1Corner = {
            x1: box1.x - box1.width / 2,
            y1: box1.y - box1.height / 2,
            x2: box1.x + box1.width / 2,
            y2: box1.y + box1.height / 2
        };

        const box2Corner = {
            x1: box2.x - box2.width / 2,
            y1: box2.y - box2.height / 2,
            x2: box2.x + box2.width / 2,
            y2: box2.y + box2.height / 2
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

                detectedItemPositions[itemClass] = {
                    x: bbox.x * scaleX,
                    y: bbox.y * scaleY,
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
        
        const detectionResult = deduplicateDetections(predictions);
        const uniquePredictions = updateCart(detectionResult);

        for (const [itemClass, predList] of Object.entries(uniquePredictions)) {
            const color = productColors[itemClass] || '#6B7BF7';

            for (const prediction of predList) {
                const bbox = prediction.bbox;
                const scaleX = ctx.canvas.width / video.videoWidth;
                const scaleY = ctx.canvas.height / video.videoHeight;
                const x = bbox.x * scaleX;
                const y = bbox.y * scaleY;
                const width = bbox.width * scaleX;
                const height = bbox.height * scaleY;

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
        drawProductLegend();
    }

    function detectFrame() {
        if (!workerId || checkoutClicked || !video.videoWidth) return;
        
        const image = new CVImage(video);
        inferEngine
            .infer(workerId, image)
            .then(function (predictions) {
                requestAnimationFrame(detectFrame);
                renderPredictions(predictions);
                // Calculate and display FPS
                if (prevTime) {
                    pastFrameTimes.push(Date.now() - prevTime);
                    if (pastFrameTimes.length > 60) pastFrameTimes.shift();
                    let total = 0;
                    _.each(pastFrameTimes, function (t) {
                        total
                        += t / 1000;
                    });
                    const fps = pastFrameTimes.length / total;
                    $("#fps").text(Math.round(fps));
                }
                prevTime = Date.now();
            })
            .catch(function (e) {
                console.log("Detection error:", e);
                requestAnimationFrame(detectFrame);
            });
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

    function drawProductLegend() {
        const padding = 10;
        const boxSize = 15;
        const lineHeight = 25;
        const legendWidth = 150;
        const legendHeight = Object.keys(productColors).length * lineHeight + padding * 2;

        const legendX = canvas[0].width - legendWidth - 20;
        const legendY = 20;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('Product Legend', legendX + padding, legendY + padding + 14);

        ctx.font = '12px sans-serif';
        let index = 0;

        for (const [product, color] of Object.entries(productColors)) {
            const y = legendY + padding + 25 + (index * lineHeight);

            ctx.fillStyle = color;
            ctx.fillRect(legendX + padding, y - boxSize + 4, boxSize, boxSize);

            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(product, legendX + padding + boxSize + 10, y);

            index++;
        }
    }

    const itemPrices = {
        "Coke": 100,
        "Dettol": 25,
        "WaiWai": 20,
        "Ariel": 540,
        "Colgate": 200,
        "Oreo": 25,
        "Colin": 175,
        "Harpic": 155,
        "Patanjali Dish Soap": 20,
        "Ketchup": 220,
    };

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

        setTimeout(() => {
            alert(`Checkout completed! Total: Rs. ${total}`);

            window.location.href = "My_Gallery.png";

        }, 2000);
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
                <p style="margin: 0;">Item's prices will be shown on right sidebar</p>
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

    async function initialize() {
        const statusIndicator = createStatusIndicator();
        
        // Add FPS counter
        const fpsCounter = $('<div id="fps-counter" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; border-radius: 5px; z-index: 1000;">FPS: <span id="fps">0</span></div>');
        $(".video-section").append(fpsCounter);
        
        try {
            statusIndicator.text("Initializing camera...");
            const cameraInitialized = await initializeCamera();
            
            if (!cameraInitialized) {
                statusIndicator.css("background", "rgba(255,0,0,0.7)").text("Camera initialization failed");
                return;
            }
            
            statusIndicator.text("Initializing detection model...");
            const inferenceInitialized = await initializeInference();
            
            if (!inferenceInitialized) {
                statusIndicator.css("background", "rgba(255,0,0,0.7)").text("Detection model initialization failed");
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
                detectFrame();
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
