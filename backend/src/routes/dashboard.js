import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNoSql } from '../utils/docNumber.js';
import { CURRENT_STOCK } from '../utils/stockEvents.js';
import { batchStock } from '../utils/batchStock.js';
import { INVOICES, withBalance } from './vendorPayment.js';

const router = Router();

const LOW_STOCK = 5; // packs; at or below this an item is listed as running low
const EXPIRY_DAYS = 90;

// Dashboard: today's and this month's sales, purchases, what's owed to
// vendors, stock value, the last 7 days' sales, items running low, batches
// expiring soon and the latest bills. Everything reads only active documents.
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('itemId', sql.Int, null).query(`
      DECLARE @today DATE = CAST(GETDATE() AS DATE);
      DECLARE @month DATE = DATEFROMPARTS(YEAR(@today), MONTH(@today), 1);

      SELECT
        ISNULL(SUM(CASE WHEN TransDate = @today THEN TotalAmount END), 0) AS TodaySales,
        COUNT(CASE WHEN TransDate = @today THEN 1 END) AS TodayBills,
        ISNULL(SUM(CASE WHEN TransDate >= @month THEN TotalAmount END), 0) AS MonthSales,
        COUNT(CASE WHEN TransDate >= @month THEN 1 END) AS MonthBills
      FROM SalesBilling WHERE IsActive = 1 AND TransDate >= @month;

      SELECT
        ISNULL(SUM(CASE WHEN TransDate = @today THEN TotalAmount END), 0) AS TodayRefunds,
        ISNULL(SUM(TotalAmount), 0) AS MonthRefunds
      FROM SalesReturn WHERE IsActive = 1 AND TransDate >= @month;

      SELECT COUNT(DISTINCT h.StockInId) AS MonthStockIns,
        ISNULL(SUM(ROUND(l.Quantity * l.Rate, 2) * (1 + (pol.CGSTPercent + pol.SGSTPercent) / 100)), 0) AS MonthPurchases
      FROM StockIn h
      LEFT JOIN StockInItem l ON l.StockInId = h.StockInId
      LEFT JOIN PurchaseOrderItem pol ON pol.LineId = l.PoLineId
      WHERE h.IsActive = 1 AND h.InDate >= @month;

      WITH Stock AS (${CURRENT_STOCK})
      SELECT i.ItemId, 'ITM' + RIGHT('000000' + CAST(i.ItemId AS VARCHAR(10)), 6) AS ItemCode, i.Name,
             i.Category, ISNULL(s.CurrentStock, 0) AS Stock, ISNULL(i.SellPrice, i.MRP) AS SellPrice
      FROM PharmacyItem i LEFT JOIN Stock s ON s.ItemId = i.ItemId
      WHERE i.IsActive = 1 AND i.Status = 'Active';

      SELECT TOP 8 h.SalesBillingId, ${docNoSql('S', 'h.SalesBillingId')} AS BillNo, h.TransDate,
             h.CustomerName, h.MobileNo, h.TotalAmount, h.CreatedAt
      FROM SalesBilling h WHERE h.IsActive = 1 ORDER BY h.SalesBillingId DESC;

      SELECT d.Day, ISNULL(SUM(h.TotalAmount), 0) AS Amount, COUNT(h.SalesBillingId) AS Bills
      FROM (SELECT DATEADD(DAY, -n, @today) AS Day FROM (VALUES (0),(1),(2),(3),(4),(5),(6)) v(n)) d
      LEFT JOIN SalesBilling h ON h.TransDate = d.Day AND h.IsActive = 1
      GROUP BY d.Day ORDER BY d.Day;

      SELECT * FROM (${INVOICES}) inv;
    `);
    const [sales, refunds, purchases, items, recent, week, invoices] = r.recordsets;

    const stockItems = items.map((i) => ({ ...i, Stock: Number(i.Stock), SellPrice: Number(i.SellPrice || 0) }));
    const stockValue = stockItems.reduce((t, i) => t + Math.max(i.Stock, 0) * i.SellPrice, 0);
    const lowStock = stockItems.filter((i) => i.Stock <= LOW_STOCK).sort((a, b) => a.Stock - b.Stock);

    const unpaid = invoices.map(withBalance).filter((x) => x.Balance > 0);
    const payable = unpaid.reduce((t, x) => t + x.Balance, 0);

    const limit = new Date();
    limit.setDate(limit.getDate() + EXPIRY_DAYS);
    const names = new Map(stockItems.map((i) => [i.ItemId, i.Name]));
    const batches = await batchStock(pool.request(), stockItems.map((i) => i.ItemId));
    const expiring = batches
      .filter((b) => b.AvailableQty > 0 && b.ExpiryDate && new Date(b.ExpiryDate) <= limit)
      .map((b) => ({ ItemId: b.ItemId, Name: names.get(b.ItemId), Batch: b.Batch, ExpiryDate: b.ExpiryDate, Qty: b.AvailableQty }))
      .sort((a, b) => new Date(a.ExpiryDate) - new Date(b.ExpiryDate));

    res.json({
      todaySales: Number(sales[0].TodaySales) - Number(refunds[0].TodayRefunds),
      todayBills: sales[0].TodayBills,
      monthSales: Number(sales[0].MonthSales) - Number(refunds[0].MonthRefunds),
      monthBills: sales[0].MonthBills,
      monthPurchases: Math.round(Number(purchases[0].MonthPurchases) * 100) / 100,
      monthStockIns: purchases[0].MonthStockIns,
      payable: Math.round(payable * 100) / 100,
      unpaidInvoices: unpaid.length,
      stockValue: Math.round(stockValue * 100) / 100,
      itemCount: stockItems.length,
      lowStockLimit: LOW_STOCK,
      expiryDays: EXPIRY_DAYS,
      week: week.map((d) => ({ day: d.Day, amount: Number(d.Amount), bills: d.Bills })),
      lowStock: lowStock.slice(0, 10),
      lowStockCount: lowStock.length,
      expiring: expiring.slice(0, 10),
      expiringCount: expiring.length,
      recentSales: recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
