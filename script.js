// script.js
const sourceCanvas = document.getElementById("source");
const previewCanvas = document.getElementById("preview");
const thresholdSlider = document.getElementById("threshold");
const ditherCheckbox = document.getElementById("dither");
const invertCheckbox = document.getElementById("invert");
const connectBtn = document.getElementById("connect-btn");
const printBtn = document.getElementById("print-btn");
const feedBtn = document.getElementById("feed-btn");
const fileInput = document.getElementById("file-input");
const uploadBox = document.getElementById("upload-box");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

let loadedImage = null;

// Initialize printer status listeners
printer.state.onStatusChange = () => {
    updateUIState();
};

function updateUIState() {
    if (printer.state.connected) {
        connectBtn.textContent = `${printer.state.deviceName} connected`;
        connectBtn.className = "btn btn-success btn-status btn-connected";
        connectBtn.disabled = true;
        printBtn.disabled = !loadedImage || printer.state.printing;
        feedBtn.disabled = printer.state.printing;
    } else {
        connectBtn.textContent = "Connect Printer";
        connectBtn.className = "btn btn-primary btn-status";
        connectBtn.disabled = false;
        printBtn.disabled = true;
        feedBtn.disabled = true;
    }

    if (printer.state.printing) {
        if (progressContainer) progressContainer.style.display = "block";
        printBtn.disabled = true;
        feedBtn.disabled = true;
    } else {
        if (progressContainer) progressContainer.style.display = "none";
    }
}

// Convert canvas back and forth for screen/printer logic
function getGrayscaleData(canvas) {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const grayscale = new Uint8Array(canvas.width * canvas.height);
    let idx = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        // Calculate grayscale value (0 is black, 255 is white)
        const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
        // Map to printer scale (255 is black/ink, 0 is white/paper)
        grayscale[idx++] = 255 - gray;
    }
    return grayscale;
}

function updatePreview() {
    if (!loadedImage) return;

    const PAPER_WIDTH = 384;
    const srcCtx = sourceCanvas.getContext("2d");

    // Scale proportionally to 384px width
    const scale = PAPER_WIDTH / loadedImage.width;
    const destWidth = PAPER_WIDTH;
    const destHeight = Math.round(loadedImage.height * scale);

    sourceCanvas.width = destWidth;
    sourceCanvas.height = destHeight;
    srcCtx.drawImage(loadedImage, 0, 0, destWidth, destHeight);

    const grayscale = getGrayscaleData(sourceCanvas);
    const thresholdVal = parseInt(thresholdSlider.value);
    const invertVal = invertCheckbox.checked;
    const ditherVal = ditherCheckbox.checked;

    const processed = new Uint8Array(grayscale.length);

    if (ditherVal) {
        // Floyd-Steinberg Dithering
        // Copy to float array for error diffusion
        const temp = new Float32Array(grayscale);
        for (let y = 0; y < destHeight; y++) {
            for (let x = 0; x < destWidth; x++) {
                const idx = y * destWidth + x;
                const oldVal = temp[idx];
                let newVal = oldVal < thresholdVal ? 0 : 255;
                if (invertVal) {
                    newVal = 255 - newVal;
                }
                processed[idx] = newVal;

                const err = oldVal - (newVal === 255 ? 255 : 0);

                if (x + 1 < destWidth) temp[idx + 1] += (err * 7) / 16;
                if (y + 1 < destHeight) {
                    if (x - 1 >= 0) temp[idx - 1 + destWidth] += (err * 3) / 16;
                    temp[idx + destWidth] += (err * 5) / 16;
                    if (x + 1 < destWidth)
                        temp[idx + 1 + destWidth] += (err * 1) / 16;
                }
            }
        }
    } else {
        // Simple Thresholding
        for (let i = 0; i < grayscale.length; i++) {
            let val = grayscale[i] < thresholdVal ? 0 : 255;
            if (invertVal) {
                val = 255 - val;
            }
            processed[i] = val;
        }
    }

    // Render preview canvas
    previewCanvas.width = destWidth;
    previewCanvas.height = destHeight;
    const prevCtx = previewCanvas.getContext("2d");
    const prevImageData = prevCtx.createImageData(destWidth, destHeight);

    for (let i = 0; i < processed.length; i++) {
        // On screen: 0 represents black, 255 represents white
        // In our array: 255 represents ink (black), 0 represents empty (white)
        const val = 255 - processed[i];
        const j = i * 4;
        prevImageData.data[j] = val;
        prevImageData.data[j + 1] = val;
        prevImageData.data[j + 2] = val;
        prevImageData.data[j + 3] = 255;
    }
    prevCtx.putImageData(prevImageData, 0, 0);
}

// Load image file
function handleImageFile(file) {
    if (!file || !file.type.startsWith("image/")) return;

    const img = new Image();
    img.onload = () => {
        loadedImage = img;
        URL.revokeObjectURL(img.src);
        updatePreview();
        updateUIState();
    };
    img.src = URL.createObjectURL(file);
}

// Draw a beautiful default test card
function loadTestCard() {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 420;
    const ctx = canvas.getContext("2d");

    // Background: White
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 384, 420);

    // Border
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 364, 400);

    // Header
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.fillText("TinyPrint X6h", 192, 45);

    ctx.font = "italic 13px system-ui, sans-serif";
    ctx.fillText("Web Bluetooth BLE Test Card", 192, 65);

    // Draw horizontal separator line
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, 80);
    ctx.lineTo(364, 80);
    ctx.stroke();

    // Cute Cat face
    ctx.lineWidth = 3;
    // Ears
    ctx.beginPath();
    ctx.moveTo(130, 150);
    ctx.lineTo(120, 100);
    ctx.lineTo(165, 135);
    ctx.fillStyle = "#000000";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(254, 150);
    ctx.lineTo(264, 100);
    ctx.lineTo(219, 135);
    ctx.fillStyle = "#000000";
    ctx.fill();

    // Head circle
    ctx.beginPath();
    ctx.arc(192, 170, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Eyes
    ctx.beginPath();
    ctx.arc(172, 160, 6, 0, Math.PI * 2);
    ctx.arc(212, 160, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();

    // Nose & Mouth
    ctx.beginPath();
    ctx.moveTo(192, 172);
    ctx.lineTo(187, 180);
    ctx.lineTo(197, 180);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(187, 182, 5, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(197, 182, 5, 0, Math.PI);
    ctx.stroke();

    // Whiskers
    ctx.beginPath();
    ctx.moveTo(135, 170);
    ctx.lineTo(100, 165);
    ctx.moveTo(135, 175);
    ctx.lineTo(95, 175);
    ctx.moveTo(135, 180);
    ctx.lineTo(100, 185);

    ctx.moveTo(249, 170);
    ctx.lineTo(284, 165);
    ctx.moveTo(249, 175);
    ctx.lineTo(289, 175);
    ctx.moveTo(249, 180);
    ctx.lineTo(284, 185);
    ctx.stroke();

    // Separator
    ctx.beginPath();
    ctx.moveTo(20, 240);
    ctx.lineTo(364, 240);
    ctx.stroke();

    // Grayscale ramp
    ctx.font = "11px monospace";
    ctx.fillText("0%  15%  30%  45%  60%  75%  90%  100%", 192, 260);

    const rampY = 270;
    const rampHeight = 25;
    const blockWidth = 344 / 8;
    for (let i = 0; i < 8; i++) {
        const val = Math.round((i / 7) * 255);
        ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
        ctx.fillRect(20 + i * blockWidth, rampY, blockWidth, rampHeight);
    }

    // Separator
    ctx.beginPath();
    ctx.moveTo(20, 315);
    ctx.lineTo(364, 315);
    ctx.stroke();

    // Sharpness pattern lines
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 30; i += 2) {
        // Vertical lines
        ctx.moveTo(35 + i * 4, 335);
        ctx.lineTo(35 + i * 4, 385);
        // Horizontal lines
        ctx.moveTo(190, 335 + i * 1.7);
        ctx.lineTo(345, 335 + i * 1.7);
    }
    ctx.stroke();

    const img = new Image();
    img.onload = () => {
        loadedImage = img;
        updatePreview();
        updateUIState();
    };
    img.src = canvas.toDataURL();
}

// Clipboard Paste Handler
window.addEventListener("paste", (event) => {
    const item = [...event.clipboardData.items].find((item) =>
        item.type.startsWith("image/"),
    );
    if (!item) return;
    const file = item.getAsFile();
    handleImageFile(file);
});

// Drag and Drop Handlers
uploadBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadBox.classList.add("dragover");
});

uploadBox.addEventListener("dragleave", () => {
    uploadBox.classList.remove("dragover");
});

uploadBox.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadBox.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    handleImageFile(file);
});

uploadBox.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    handleImageFile(file);
});

// Event Listeners for controls
thresholdSlider.addEventListener("input", () => {
    updatePreview();
});

ditherCheckbox.addEventListener("change", updatePreview);
invertCheckbox.addEventListener("change", updatePreview);

connectBtn.addEventListener("click", async () => {
    if (!printer.state.connected) {
        connectBtn.disabled = true;
        connectBtn.classList.add("btn-loading");
        connectBtn.textContent = "Connecting…";

        try {
            await printer.connect();
        } catch (err) {
            alert(`Connection failed: ${err.message}`);
        } finally {
            if (!printer.state.connected) {
                connectBtn.classList.remove("btn-loading");
                connectBtn.textContent = "Connect Printer";
                connectBtn.disabled = false;
            }
        }
    }
});

feedBtn.addEventListener("click", async () => {
    try {
        await printer.feed();
    } catch (err) {
        alert(`Feed failed: ${err.message}`);
    }
});

printBtn.addEventListener("click", async () => {
    if (!loadedImage) return;

    // Extract printer-compatible grayscale data (where 255 is black/ink, 0 is white/paper)
    const grayscale = getGrayscaleData(previewCanvas);

    // In previewCanvas, the image has already been dithered/thresholded/inverted on screen
    // On screen: 0 is black/ink, 255 is white/paper
    // So getGrayscaleData returns: 255 for black/ink, 0 for white/paper.
    // This is exactly what the printer's print method expects!
    try {
        if (progressContainer) progressContainer.style.display = "block";
        if (progressBar) progressBar.style.width = "0%";
        if (progressText) progressText.textContent = "Preparing print job...";

        await printer.print(grayscale, (percent) => {
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressText)
                progressText.textContent = `Printing... ${percent}%`;
        });

        if (progressText) progressText.textContent = "Print completed!";
        setTimeout(() => {
            if (!printer.state.printing && progressContainer) {
                progressContainer.style.display = "none";
            }
        }, 1500);
    } catch (err) {
        alert(`Print failed: ${err.message}`);
        if (progressContainer) progressContainer.style.display = "none";
    }
});

// Load default test card automatically on boot
window.addEventListener("DOMContentLoaded", () => {
    loadTestCard();
    updateUIState();
});
