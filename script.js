const video = document.getElementById("video");
const cartList = document.getElementById("cart-list");
const totalPrice = document.getElementById("total-price");
const checkoutBtn = document.getElementById("checkout");
const checkoutContainer = document.getElementById("checkout-container");

const prices = {
    "Coke": 100,
    "Wai Wai": 20,
    "Dettol": 25,
    "Ariel": 150
};

let cart = [];
let previousDetections = {}; // Track previously detected objects by their unique key

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// Append the canvas on top of the video for bounding box drawing
video.parentNode.appendChild(canvas);
canvas.style.position = 'absolute';
canvas.style.top = '0';
canvas.style.left = '0';

async function detectObjects() {
    // Adjust the canvas size to match the video feed
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current frame from the video to the canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageBase64 = canvas.toDataURL("image/jpeg").split(",")[1];

    try {
        const response = await axios({
            method: "POST",
            url: "https://detect.roboflow.com/shopping-cart-mmcht/4",
            params: { api_key: "Baro4dREClDcoSmHZclS" },
            data: imageBase64,
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        updateCart(response.data);
        drawDetections(response.data);
    } catch (error) {
        console.error("Error detecting objects:", error.message);
    }
}

function updateCart(detectedObjects) {
    const currentDetections = {}; // Temporary object to store currently detected objects

    detectedObjects.predictions.forEach(item => {
        if (item.confidence >= 0.8 && prices[item.class]) {
            const objKey = `${item.class}_${Math.round(item.x)}_${Math.round(item.y)}`;
            currentDetections[objKey] = true;

            // Add item to cart if it's detected for the first time
            if (!previousDetections[objKey]) {
                cart.push({ name: item.class, price: prices[item.class] });
            }
        }
    });

    // Remove items from the cart if they're no longer detected
    Object.keys(previousDetections).forEach(objKey => {
        if (!currentDetections[objKey]) {
            cart = cart.filter(item => `${item.name}_${item.x}_${item.y}` !== objKey);
        }
    });

    previousDetections = currentDetections;

    renderCart();
}

function renderCart() {
    cartList.innerHTML = "";
    let total = 0;
    cart.forEach((item, index) => {
        total += item.price;
        cartList.innerHTML += `<li>Object ${index + 1}: ${item.name} - Rs. ${item.price}</li>`;
    });
    totalPrice.innerText = `Rs. ${total}`;
}

function drawDetections(detectedObjects) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    detectedObjects.predictions.forEach(item => {
        if (item.confidence >= 0.8) {
            // Draw bounding box around detected object
            ctx.strokeStyle = "red";
            ctx.lineWidth = 2;
            ctx.strokeRect(item.x - item.width / 2, item.y - item.height / 2, item.width, item.height);

            // Add label with confidence percentage
            ctx.fillStyle = "red";
            ctx.font = "16px Arial";
            ctx.fillText(`${item.class} (${(item.confidence * 100).toFixed(1)}%)`, item.x - item.width / 2, item.y - item.height / 2 - 5);
        }
    });
}

checkoutBtn.addEventListener("click", () => {
    checkoutContainer.innerHTML = `<h3>Total: Rs. ${totalPrice.innerText}</h3><p>Pay via QR:</p><img src="My_Gallery.png" alt="QR Code" style="width: 150px; height: auto;">`;
});

// Start video feed
navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;
});

// Run detection every 5 seconds
setInterval(detectObjects, 5000);
