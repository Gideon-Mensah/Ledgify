// Build a printable customer invoice without changing or reposting its accounting data.

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatCurrency as safeFormatCurrency } from "./currency";

// Formats currency.
const formatCurrency = (amount, currency = "GBP") =>
  safeFormatCurrency(amount, currency, { locale: "en-GB" });

// Calculates line amounts.
const calculateLineAmounts = (
  item,
  pricingMode = "exclusive"
) => {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const discountRate =
    Number(item.discountRate) || 0;
  const vatRate = Number(item.vatRate) || 0;

  const grossAmount = quantity * unitPrice;

  const discountAmount =
    grossAmount * (discountRate / 100);

  const discountedAmount =
    grossAmount - discountAmount;

  let netAmount = discountedAmount;
  let vatAmount =
    discountedAmount * (vatRate / 100);
  let total = netAmount + vatAmount;

  if (pricingMode === "inclusive") {
    netAmount =
      vatRate > 0
        ? discountedAmount /
          (1 + vatRate / 100)
        : discountedAmount;

    vatAmount = discountedAmount - netAmount;
    total = discountedAmount;
  }

  return {
    grossAmount,
    discountAmount,
    netAmount,
    vatAmount,
    total,
  };
};

// Calculates invoice totals.
const calculateInvoiceTotals = (invoice) => {
  return (invoice.items || []).reduce(
    (totals, item) => {
      const amounts = calculateLineAmounts(
        item,
        invoice.pricingMode
      );

      totals.subtotal += amounts.netAmount;
      totals.discount += amounts.discountAmount;
      totals.vat += amounts.vatAmount;
      totals.total += amounts.total;

      return totals;
    },
    {
      subtotal: 0,
      discount: 0,
      vat: 0,
      total: 0,
    }
  );
};

// Adds address lines.
const addAddressLines = (
  document,
  addressLines,
  x,
  startY
) => {
  let currentY = startY;

  (addressLines || []).forEach((line) => {
    document.text(String(line), x, currentY);
    currentY += 5;
  });

  return currentY;
};

// Downloads invoice pdf.
export const downloadInvoicePdf = (
  invoice,
  company = {}
) => {
  if (!invoice) {
    throw new Error("Invoice is required.");
  }

  const companyDetails = {
    name:
      company.name || "Accounting Cloud Ltd",
    address:
      company.address || [
        "12 Business Park",
        "Sheffield, S1 2AB",
        "United Kingdom",
      ],
    email:
      company.email ||
      "accounts@accountingcloud.co.uk",
    phone: company.phone || "",
    vatNumber: company.vatNumber || "",
    bankName:
      company.bankName ||
      "Business Current Account",
    sortCode:
      company.sortCode || "20-00-00",
    accountNumber:
      company.accountNumber || "12345678",
  };

  const currency = invoice.currency || "GBP";
  const totals = calculateInvoiceTotals(invoice);

  const amountPaid = Math.min(
    Number(invoice.amountPaid) || 0,
    totals.total
  );

  const balanceDue = Math.max(
    totals.total - amountPaid,
    0
  );

  const document = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth =
    document.internal.pageSize.getWidth();

  const margin = 18;
  const rightEdge = pageWidth - margin;

  document.setProperties({
    title: invoice.invoiceNumber,
    subject: `Invoice for ${invoice.customer}`,
    author: companyDetails.name,
    creator: "Ledgify Accounting",
  });

  /*
   * Header
   */

  document.setFillColor(14, 116, 144);
  document.roundedRect(
    margin,
    16,
    18,
    18,
    3,
    3,
    "F"
  );

  document.setTextColor(255, 255, 255);
  document.setFont("helvetica", "bold");
  document.setFontSize(11);
  document.text("AC", margin + 5, 27.5);

  document.setTextColor(15, 23, 42);
  document.setFontSize(15);
  document.text(
    companyDetails.name,
    margin + 23,
    22
  );

  document.setFont(
    "helvetica",
    "normal"
  );
  document.setFontSize(9);
  document.setTextColor(100, 116, 139);

  let companyAddressY = 27;

  companyDetails.address.forEach(
    (addressLine) => {
      document.text(
        addressLine,
        margin + 23,
        companyAddressY
      );

      companyAddressY += 4.5;
    }
  );

  document.setFont(
    "helvetica",
    "bold"
  );
  document.setFontSize(9);
  document.setTextColor(100, 116, 139);
  document.text(
    "INVOICE",
    rightEdge,
    20,
    {
      align: "right",
    }
  );

  document.setFontSize(20);
  document.setTextColor(15, 23, 42);
  document.text(
    invoice.invoiceNumber,
    rightEdge,
    29,
    {
      align: "right",
    }
  );

  document.setDrawColor(226, 232, 240);
  document.line(
    margin,
    48,
    rightEdge,
    48
  );

  /*
   * Customer and invoice details
   */

  document.setFontSize(8);
  document.setTextColor(100, 116, 139);
  document.setFont(
    "helvetica",
    "bold"
  );
  document.text("BILL TO", margin, 58);

  document.setFontSize(11);
  document.setTextColor(15, 23, 42);
  document.text(
    invoice.customer || "Customer",
    margin,
    65
  );

  document.setFont(
    "helvetica",
    "normal"
  );
  document.setFontSize(9);
  document.setTextColor(71, 85, 105);

  let customerY = addAddressLines(
    document,
    invoice.customerAddress,
    margin,
    71
  );

  if (invoice.customerEmail) {
    document.text(
      invoice.customerEmail,
      margin,
      customerY
    );
  }

  const detailsX = 125;

  const detailRows = [
    ["Invoice date", invoice.issueDate || "—"],
    ["Due date", invoice.dueDate || "—"],
    ["Reference", invoice.reference || "—"],
    ["Currency", currency],
  ];

  let detailY = 58;

  detailRows.forEach(([label, value]) => {
    document.setFontSize(8);
    document.setFont(
      "helvetica",
      "normal"
    );
    document.setTextColor(100, 116, 139);
    document.text(label, detailsX, detailY);

    document.setFontSize(9);
    document.setFont(
      "helvetica",
      "bold"
    );
    document.setTextColor(15, 23, 42);
    document.text(
      String(value),
      rightEdge,
      detailY,
      {
        align: "right",
      }
    );

    detailY += 9;
  });

  /*
   * Invoice items
   */

  const itemRows = (
    invoice.items || []
  ).map((item) => {
    const amounts = calculateLineAmounts(
      item,
      invoice.pricingMode
    );

    return [
      item.description || "",
      Number(item.quantity) || 0,
      formatCurrency(
        item.unitPrice,
        currency
      ),
      `${
        Number(item.discountRate) || 0
      }%`,
      `${Number(item.vatRate) || 0}%`,
      formatCurrency(
        amounts.total,
        currency
      ),
    ];
  });

  autoTable(document, {
    startY: 102,
    margin: {
      left: margin,
      right: margin,
    },
    head: [
      [
        "Description",
        "Qty",
        "Unit price",
        "Discount",
        "VAT",
        "Total",
      ],
    ],
    body: itemRows,
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 3.5,
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: {
        bottom: 0.2,
      },
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: [100, 116, 139],
      fontStyle: "bold",
      fontSize: 7.5,
    },
    columnStyles: {
      0: {
        cellWidth: 66,
      },
      1: {
        halign: "right",
        cellWidth: 14,
      },
      2: {
        halign: "right",
        cellWidth: 27,
      },
      3: {
        halign: "right",
        cellWidth: 22,
      },
      4: {
        halign: "right",
        cellWidth: 17,
      },
      5: {
        halign: "right",
        cellWidth: 28,
        fontStyle: "bold",
      },
    },
  });

  const finalTableY =
    document.lastAutoTable?.finalY || 120;

  /*
   * Notes and totals
   */

  let summaryY = finalTableY + 12;

  if (summaryY > 225) {
    document.addPage();
    summaryY = 25;
  }

  document.setFontSize(8);
  document.setFont(
    "helvetica",
    "bold"
  );
  document.setTextColor(100, 116, 139);
  document.text(
    "NOTES",
    margin,
    summaryY
  );

  document.setFont(
    "helvetica",
    "normal"
  );
  document.setFontSize(8.5);
  document.setTextColor(71, 85, 105);

  const noteLines =
    document.splitTextToSize(
      invoice.notes ||
        "Thank you for your business.",
      88
    );

  document.text(
    noteLines,
    margin,
    summaryY + 6
  );

  const totalsX = 126;
  const totalsValueX = rightEdge;

  const totalRows = [
    ["Subtotal", totals.subtotal],
  ];

  if (totals.discount > 0) {
    totalRows.push([
      "Discount",
      -totals.discount,
    ]);
  }

  totalRows.push(["VAT", totals.vat]);

  let totalsY = summaryY;

  totalRows.forEach(([label, value]) => {
    document.setFont(
      "helvetica",
      "normal"
    );
    document.setFontSize(9);
    document.setTextColor(100, 116, 139);
    document.text(label, totalsX, totalsY);

    document.setFont(
      "helvetica",
      "bold"
    );
    document.setTextColor(15, 23, 42);
    document.text(
      formatCurrency(value, currency),
      totalsValueX,
      totalsY,
      {
        align: "right",
      }
    );

    totalsY += 8;
  });

  document.setDrawColor(226, 232, 240);
  document.line(
    totalsX,
    totalsY - 3,
    totalsValueX,
    totalsY - 3
  );

  document.setFontSize(12);
  document.setTextColor(15, 23, 42);
  document.setFont(
    "helvetica",
    "bold"
  );
  document.text("Total", totalsX, totalsY + 4);

  document.text(
    formatCurrency(
      totals.total,
      currency
    ),
    totalsValueX,
    totalsY + 4,
    {
      align: "right",
    }
  );

  totalsY += 13;

  if (amountPaid > 0) {
    document.setFontSize(9);
    document.setTextColor(22, 163, 74);
    document.text(
      "Amount paid",
      totalsX,
      totalsY
    );

    document.text(
      formatCurrency(
        amountPaid,
        currency
      ),
      totalsValueX,
      totalsY,
      {
        align: "right",
      }
    );

    totalsY += 8;
  }

  document.setFontSize(10);
  document.setTextColor(14, 116, 144);
  document.text(
    "Amount due",
    totalsX,
    totalsY
  );

  document.text(
    formatCurrency(
      balanceDue,
      currency
    ),
    totalsValueX,
    totalsY,
    {
      align: "right",
    }
  );

  /*
   * Footer
   */

  const pageHeight =
    document.internal.pageSize.getHeight();

  document.setDrawColor(226, 232, 240);
  document.line(
    margin,
    pageHeight - 28,
    rightEdge,
    pageHeight - 28
  );

  document.setFont(
    "helvetica",
    "normal"
  );
  document.setFontSize(8);
  document.setTextColor(100, 116, 139);

  document.text(
    `Payment details: ${companyDetails.bankName}`,
    pageWidth / 2,
    pageHeight - 20,
    {
      align: "center",
    }
  );

  document.text(
    `Sort code: ${companyDetails.sortCode} · Account number: ${companyDetails.accountNumber}`,
    pageWidth / 2,
    pageHeight - 15,
    {
      align: "center",
    }
  );

  document.save(
    `${invoice.invoiceNumber}.pdf`
  );
};
