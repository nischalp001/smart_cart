// Include Interface.js (ensure it's linked in your HTML file)
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

async function detectObjects() {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
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
    } catch (error) {
        console.error("Error detecting objects:", error.message);
    }
}

function updateCart(detectedObjects) {
    cart = [];
    detectedObjects.predictions.forEach(item => {
        if (prices[item.class]) {
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

checkoutBtn.addEventListener("click", () => {
    checkoutContainer.innerHTML = `<h3>Total: Rs. ${totalPrice.innerText}</h3><p>Pay via QR:</p><img src="My_Gallery.png" alt="QR Code" style="width: 150px; height: auto;">`;
});
// Start video feed
navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;
});

// Run detection every 3 seconds
setInterval(detectObjects, 3000);
