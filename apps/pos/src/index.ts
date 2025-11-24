// POS stub: formats a receipt and sends ESC/POS commands for TEP-300 SUE.
// Replace the USB vendorId/productId with the printer's values (use `lsusb` or Windows device manager).
import escpos from "escpos";

type LineItem = { name: string; qty: number; total: number };

const vendorId = 0x0456; // placeholder
const productId = 0x0808; // placeholder

function printReceipt(orderId: string, items: LineItem[], total: number) {
  const device = new escpos.USB(vendorId, productId);
  const printer = new escpos.Printer(device, { width: 48 });

  device.open(() => {
    printer
      .text("Mwalimu Cosmetics")
      .text(`Order ${orderId}`)
      .text("-----------------------------");

    items.forEach((item) => {
      const line = `${item.qty} x ${item.name}`.slice(0, 28);
      const amount = item.total.toFixed(2).padStart(10, " ");
      printer.text(`${line}${amount}`);
    });

    printer
      .text("-----------------------------")
      .text(`TOTAL: ${total.toFixed(2)}`)
      .cut()
      .close();
  });
}

if (process.env.DEMO !== "false") {
  printReceipt(
    "POS-1001",
    [
      { name: "Shea Body Butter", qty: 1, total: 15.5 },
      { name: "Matte Lipstick", qty: 2, total: 24.0 }
    ],
    39.5
  );
}
