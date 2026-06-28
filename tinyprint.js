const PAPER_WIDTH = 384;
const BLOCK_LINES = 20;
const GAP_LINES = 64;
const BLE_PACKET_SIZE = 20;
const BLE_PACKET_DELAY = 4;

const CHECKSUM_TABLE = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x80) {
                crc = ((crc << 1) ^ 0x07) & 0xff;
            } else {
                crc = (crc << 1) & 0xff;
            }
        }
        table[i] = crc;
    }
    return table;
})();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function crc8(buf, offset, length) {
    let crc = 0;
    const end = offset + length;
    for (let i = offset; i < end; i++) {
        crc = CHECKSUM_TABLE[(crc ^ buf[i]) & 0xff];
    }
    return crc;
}

function uint16(value) {
    return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function concat(...arrays) {
    const length = arrays.reduce((a, b) => a + b.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }
    return result;
}

function createCommand(commandId, payload = new Uint8Array()) {
    const header = new Uint8Array([0x51, 0x78, commandId, 0x00]);
    const lengthBytes = uint16(payload.length);
    const cmd = new Uint8Array(
        header.length + lengthBytes.length + payload.length + 2,
    );

    cmd.set(header, 0);
    cmd.set(lengthBytes, header.length);
    cmd.set(payload, header.length + lengthBytes.length);

    const checksumOffset = header.length + lengthBytes.length; // index 6
    const checksum = crc8(cmd, checksumOffset, payload.length);

    cmd[cmd.length - 2] = checksum;
    cmd[cmd.length - 1] = 0xff;

    return cmd;
}

function createFeedPaperCommand(lines) {
    return createCommand(0xa1, uint16(lines));
}

function createPrintLinesCommand(data) {
    if (!window.LZO) {
        throw new Error("LZO compression library not loaded yet.");
    }
    const compressed = window.LZO.compress(data);

    // Header for LZO chunk: uncompressed length (16-bit LE), compressed length (16-bit LE)
    const header = new Uint8Array(4);
    header[0] = data.length & 0xff;
    header[1] = (data.length >> 8) & 0xff;
    header[2] = compressed.length & 0xff;
    header[3] = (compressed.length >> 8) & 0xff;

    const payload = new Uint8Array(header.length + compressed.length);
    payload.set(header, 0);
    payload.set(compressed, header.length);

    return createCommand(0xcf, payload);
}

function createPrintLinesCommands(
    data,
    lineLen = PAPER_WIDTH,
    blockLines = BLOCK_LINES,
) {
    const totalLen = data.length;
    const blockLen = lineLen * blockLines;

    if (totalLen % lineLen !== 0) {
        throw new Error(
            `Data length (${totalLen}) must be a multiple of line length (${lineLen})`,
        );
    }

    // Add padding to prevent start artifacts (1 blank line of 0x00 pixels)
    const padding = new Uint8Array(lineLen);
    const prepared = concat(padding, data);
    const prepLen = prepared.length;

    let commands = new Uint8Array(0);

    for (let blockStart = 0; blockStart < totalLen; blockStart += blockLen) {
        const blockEnd = Math.min(blockStart + blockLen, prepLen);
        const block = prepared.subarray(blockStart, blockEnd);

        // Pack 2 grayscale pixels (4-bit each) into 1 byte
        const packedLen = Math.ceil(block.length / 2);
        const packed = new Uint8Array(packedLen);

        for (let i = 0; i < block.length; i += 2) {
            const p0 = block[i];
            const p1 = i + 1 < block.length ? block[i + 1] : 0;
            // Pack using upper 4 bits of each pixel byte
            packed[i >> 1] = ((p0 >> 4) << 4) | (p1 >> 4);
        }

        const cmd = createPrintLinesCommand(packed);
        commands = concat(commands, cmd);
    }

    return commands;
}

function createPrintCommands(data) {
    const printCommands = createPrintLinesCommands(
        data,
        PAPER_WIDTH,
        BLOCK_LINES,
    );
    const feedCommand = createFeedPaperCommand(GAP_LINES);
    return concat(printCommands, feedCommand);
}

const printer = (() => {
    const UUID = {
        SERVICE: "0000ae30-0000-1000-8000-00805f9b34fb",
        WRITE: "0000ae01-0000-1000-8000-00805f9b34fb", // matching UUID_WRITE from printer.py
    };

    let device = null;
    let server = null;
    let service = null;
    let writeCharacteristic = null;

    const state = {
        connected: false,
        deviceName: "",
        printing: false,
        onStatusChange: null,
    };

    async function connect() {
        console.log("Requesting Web Bluetooth device...");
        device = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: "X6h-" },
                { namePrefix: "x6h-" },
                { services: [UUID.SERVICE] },
            ],
            optionalServices: [UUID.SERVICE],
        });

        device.addEventListener("gattserverdisconnected", onDisconnected);
        console.log(
            `Connecting to GATT server on ${device.name || "selected device"}...`,
        );

        server = await device.gatt.connect();
        service = await server.getPrimaryService(UUID.SERVICE);
        writeCharacteristic = await service.getCharacteristic(UUID.WRITE);

        state.connected = true;
        state.deviceName = device.name;

        console.log("Printer connected successfully");
        if (state.onStatusChange) state.onStatusChange();
        return true;
    }

    function disconnect() {
        if (device && device.gatt.connected) {
            console.log("Disconnecting device...");
            device.gatt.disconnect();
        }
    }

    function onDisconnected() {
        console.log("Printer disconnected");
        state.connected = false;
        state.deviceName = "";
        writeCharacteristic = null;
        if (state.onStatusChange) state.onStatusChange();
    }

    async function writeBytes(bytes, onProgress) {
        if (!state.connected || !writeCharacteristic) {
            throw new Error("Printer is not connected");
        }

        state.printing = true;
        if (state.onStatusChange) state.onStatusChange();

        try {
            const total = bytes.length;
            for (let i = 0; i < total; i += BLE_PACKET_SIZE) {
                const chunk = bytes.slice(i, i + BLE_PACKET_SIZE);
                await writeCharacteristic.writeValueWithoutResponse(chunk);
                if (onProgress) {
                    onProgress(Math.min(100, Math.round((i / total) * 100)));
                }
                await delay(BLE_PACKET_DELAY);
            }
            if (onProgress) {
                onProgress(100);
            }
        } finally {
            state.printing = false;
            if (state.onStatusChange) state.onStatusChange();
        }
    }

    async function feed(lines = GAP_LINES) {
        console.log(`Feeding paper by ${lines} lines...`);
        const bytes = createFeedPaperCommand(lines);
        await writeBytes(bytes);
    }

    async function print(grayscaleData, onProgress) {
        console.log("Compiling and sending print job...");
        const bytes = createPrintCommands(grayscaleData);
        await writeBytes(bytes, onProgress);
    }

    return {
        state,
        connect,
        disconnect,
        feed,
        print,
    };
})();
