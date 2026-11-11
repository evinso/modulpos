// Constants shared by the price template (pricingEngine) and the order profit panel (orderProfit), so both use the same tax model.
//
// VAT on invoices for commission, shipping, marketplace service fees and other costs. All these amounts are VAT-INCLUSIVE
// (what the marketplace takes from the payout), so the VAT inside them is amount * 0.2 / 1.2 and, for a VAT payer, comes off the VAT to pay.
const EXPENSE_VAT = 0.2;

module.exports = { EXPENSE_VAT };
