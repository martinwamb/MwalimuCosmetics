import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";

type LineItem = { name: string; qty: number; total: number };

const vendorId = 0x0456; // placeholder
const productId = 0x0808; // placeholder

async function printReceipt(orderId: string, items: LineItem[], total: number) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `usb://${vendorId}:${productId}`,
    characterSet: "PC437_USA",
    removeSpecialCharacters: false,
    options: { timeout: 5000 }
  });

  const connected = await printer.isPrinterConnected();
  if (!connected) {
    console.warn("Thermal printer not detected over USB");
    return;
  }

  printer.println("Mwalimu Cosmetics");
  printer.println(`Order ${orderId}`);
  printer.drawLine();

  items.forEach((item) => {
    const line = `${item.qty} x ${item.name}`.slice(0, 28);
    const amount = item.total.toFixed(2).padStart(10, " ");
    printer.println(`${line}${amount}`);
  });

  printer.drawLine();
  printer.println(`TOTAL: ${total.toFixed(2)}`);
  printer.cut();

  await printer.execute();
}

if (process.env.DEMO !== "false") {
  printReceipt(
    "POS-1001",
    [
      { name: "Shea Body Butter", qty: 1, total: 15.5 },
      { name: "Matte Lipstick", qty: 2, total: 24.0 }
    ],
    39.5
  ).catch((err) => console.error("Print failed", err));
}
