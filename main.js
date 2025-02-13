$(function () {
    const { InferenceEngine, CVImage } = inferencejs;
    const inferEngine = new InferenceEngine();
    const video = $("#video")[0];
    var workerId;
    var detectedItems = {}; // Store detected items globally
    var checkoutClicked = false;

    const startVideoStreamPromise = navigator.mediaDevices
        .getUserMedia({
            audio: false,
            video: {
                facingMode: "environment"
            }
        })
        .then(function (stream) {
            return new Promise(function (resolve) {
                video.srcObject = stream;
                video.onloadeddata = function () {
                    video.play();
                    resolve();
                };
            });
        });

    const loadModelPromise = new Promise(function (resolve, reject) {
        inferEngine
            .startWorker("shopping-cart-mmcht", "5", "rf_zUglaEqt57VTuKys33uspdJjBr72")
            .then(function (id) {
                workerId = id;
                resolve();
            })
            .catch(reject);
    });

    Promise.all([startVideoStreamPromise, loadModelPromise]).then(function () {
        $("body").removeClass("loading");
        resizeCanvas();
        detectFrame();
    });

    var canvas, ctx;
    const font = "16px sans-serif";

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
            width: "100%",
            height: "100%",
            left: 0,
            top: 0
        });

        videoContainer.append(canvas);
    }

    const renderPredictions = function (predictions) {
        if (checkoutClicked) return; // Stop rendering if checkout was clicked

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        $("#detections").empty();

        const video = $("#video")[0];
        const scaleX = ctx.canvas.width / video.videoWidth;
        const scaleY = ctx.canvas.height / video.videoHeight;

        // Reset detected items object each frame
        detectedItems = {}; 

        predictions.forEach(function (prediction) {
            const bbox = prediction.bbox;
            const x = bbox.x * scaleX;
            const y = bbox.y * scaleY;
            const width = bbox.width * scaleX;
            const height = bbox.height * scaleY;

            // Update detected items count
            const item = prediction.class;
            if (detectedItems[item]) {
                detectedItems[item]++;
            } else {
                detectedItems[item] = 1;
            }

            ctx.strokeStyle = prediction.color;
            ctx.lineWidth = 4;
            ctx.strokeRect(
                x - width / 2,
                y - height / 2,
                width,
                height
            );

            ctx.fillStyle = prediction.color;
            ctx.fillRect(
                x - width / 2,
                y - height / 2 - 20,
                ctx.measureText(prediction.class).width + 8,
                20
            );
            ctx.fillStyle = "#000";
            ctx.fillText(prediction.class, x - width / 2 + 4, y - height / 2 - 4);
        });

        // Display the detected items and their count on the right side
        $("#detections").empty();
        for (let item in detectedItems) {
            const count = detectedItems[item];
            const price = itemPrices[item] * count;
            $("#detections").append(`
                <div class="cart-item">
                    ${item} x ${count} - Rs. ${price}
                </div>
            `);
        }
    };

    var prevTime;
    var pastFrameTimes = [];

    const detectFrame = function () {
        if (!workerId || checkoutClicked) return; // Stop detection after checkout
        const image = new CVImage(video);

        inferEngine
            .infer(workerId, image)
            .then(function (predictions) {
                requestAnimationFrame(detectFrame);
                renderPredictions(predictions);

                if (prevTime) {
                    pastFrameTimes.push(Date.now() - prevTime);
                    if (pastFrameTimes.length > 60) pastFrameTimes.shift();

                    var total = 0;
                    _.each(pastFrameTimes, function (t) {
                        total += t / 1000;
                    });

                    var fps = pastFrameTimes.length / total;
                    $("#fps").text(Math.round(fps));
                }

                prevTime = Date.now();
            })
            .catch(function (e) {
                console.log("CAUGHT", e);
                requestAnimationFrame(detectFrame);
            });
    };

    // Prices for detected items
    const itemPrices = {
        "Coke": 100,
        "Dettol": 25,
        "Wai Wai": 20,
        "Ariel": 175
    };

    document.getElementById('checkoutButton').addEventListener('click', function() {
        checkoutClicked = true; // Mark that checkout has been clicked
        
        let total = 0;
    
        // Calculate the total based on detected items stored globally
        for (let item in detectedItems) {
            const count = detectedItems[item];
            total += itemPrices[item] * count;
        }
    
        // Display the total price on the page
        document.getElementById('detections').innerHTML = `<div class="cart-item"><span>Total Price: Rs. ${total}</span></div>`;
    
        // Change button text to indicate processing
        this.innerText = "Processing Checkout...";
        
        // Print the total to the console
        console.log("Total Price: Rs. " + total);

        // Show the modal with the total
        const modalHtml = `
            <div id="checkoutModal" class="checkout-modal">
                <div class="checkout-modal-content">
                    <span class="close-button" id="closeModal">&times;</span>
                    <h2>Your Total: Rs. ${total}</h2>
                    <button id="proceedToPaymentButton">Proceed to Payment</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modalHtml);
        document.getElementById('checkoutModal').style.display = "block";

        // Close modal when 'X' is clicked
        document.getElementById('closeModal').addEventListener('click', function() {
            document.getElementById('checkoutModal').style.display = "none";
        });

        // Proceed to payment logic
        document.getElementById('proceedToPaymentButton').addEventListener('click', function() {
            alert("Proceeding to payment...");

            // Add payment logic here
            document.getElementById('checkoutModal').style.display = "none";
            detectedItems = [];
            document.getElementById('detections').innerHTML = `<div class="cart-item"><span>Checkout Complete</span><span>Rs. ${total}</span></div>`;
            this.innerText = "Proceeding to Payment...";

            // Display the image overlay after payment
            const imageUrl = 'My_Gallery.png'; // Replace with the actual image URL
            const imageHtml = `
                <div id="paymentImage" class="payment-image-overlay">
                    <img src="${imageUrl}" alt="Payment Success" />
                </div>
            `;
            document.body.insertAdjacentHTML("beforeend", imageHtml);

            // Style the image overlay
            document.getElementById('paymentImage').style.position = "fixed";
            document.getElementById('paymentImage').style.top = "0";
            document.getElementById('paymentImage').style.left = "0";
            document.getElementById('paymentImage').style.width = "100%";
            document.getElementById('paymentImage').style.height = "100%";
            document.getElementById('paymentImage').style.backgroundColor = "rgba(255, 255, 255, 1)";
            document.getElementById('paymentImage').style.display = "flex";
            document.getElementById('paymentImage').style.alignItems = "center";
            document.getElementById('paymentImage').style.justifyContent = "center";
            document.getElementById('paymentImage').style.zIndex = "9999";

            // After 5 seconds, reload the page
            setTimeout(function() {
                location.reload();
            }, 7000); // Delay of 5 seconds
        });

        this.innerText = "Processing Checkout...";
    });

    // Example detection every 3 seconds
    setInterval(function() {
        detectFrame();
    }, 3000); // Detect items every 3 seconds
});
