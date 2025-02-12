const video = document.getElementById("video");
const cartList = document.getElementById("cart-list");
const totalPrice = document.getElementById("total-price");
const checkoutBtn = document.getElementById("checkout");
const checkoutContainer = document.getElementById("checkout-container");

const prices = {
    "Coke": 100,
    "wai wai": 20,
    "Ariel": 150
};

let cart = [];

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

async function detectObjects() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
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
    cart = [];
    detectedObjects.predictions.forEach(item => {
        if (item.confidence >= 0.8 && prices[item.class]) { // Filter by confidence threshold
            cart.push({ name: item.class, price: prices[item.class] });
        }
    });
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
        if (item.confidence >= 0.8) { // Only label objects with confidence ≥ 0.8
            ctx.strokeStyle = "red";
            ctx.lineWidth = 2;
            ctx.strokeRect(item.x - item.width / 2, item.y - item.height / 2, item.width, item.height);
            ctx.fillStyle = "red";
            ctx.font = "16px Arial";
            ctx.fillText(`${item.class} (${(item.confidence * 100).toFixed(1)}%)`, item.x - item.width / 2, item.y - item.height / 2 - 5);
        }
    });

    // Display the updated canvas on top of the video
    video.parentNode.appendChild(canvas);
}

checkoutBtn.addEventListener("click", () => {
    checkoutContainer.innerHTML = `<h3>Total: Rs. ${totalPrice.innerText}</h3><p>Pay via QR:</p><img src="My_Gallery.png" alt="QR Code" style="width: 150px; height: auto;">`;
});

// Start video feed
navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;
});

// Run detection every 3 seconds
setInterval(detectObjects, 3000);
