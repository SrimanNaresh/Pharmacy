import { docNoSql } from './docNumber.js';

// One row per stock change: Kind is purchase / return / issue /
// sales-return / adjustment (opening stock is an Adjust In), Qty is signed.
// At orders the history; @itemId (NULL = all).
export const EVENTS = `
  SELECT l.ItemId, 'purchase' AS Kind, l.Quantity + l.FreeQty AS Qty, h.CreatedAt AS At, h.InDate AS DocDate,
         'Stock In ' + ${docNoSql('SI', 'h.StockInId')} + ' · batch ' + l.BatchNo
           + CASE WHEN l.FreeQty > 0 THEN ' · incl. ' + FORMAT(l.FreeQty, '0.##') + ' free' ELSE '' END AS Details,
         v.VendorName, h.CreatedBy AS ByUser, 'stock-in' AS RefType, h.StockInId AS RefId
  FROM StockInItem l JOIN StockIn h ON h.StockInId = l.StockInId AND h.IsActive = 1
  JOIN Vendor v ON v.VendorId = h.VendorId
  WHERE (@itemId IS NULL OR l.ItemId = @itemId)
  UNION ALL
  SELECT l.ItemId, 'return', -l.Quantity, h.CreatedAt, h.ReturnDate,
         'Return ' + ${docNoSql('RT', 'h.StockReturnId')} + ' to vendor · batch ' + l.BatchNo,
         v.VendorName, h.CreatedBy, 'stock-return', h.StockReturnId
  FROM StockReturnItem l JOIN StockReturn h ON h.StockReturnId = l.StockReturnId AND h.IsActive = 1
  JOIN Vendor v ON v.VendorId = h.VendorId
  WHERE (@itemId IS NULL OR l.ItemId = @itemId)
  UNION ALL
  SELECT l.ItemId, 'issue', -l.Quantity, h.CreatedAt, h.TransDate,
         'Sale ' + ${docNoSql('S', 'h.SalesBillingId')} + ISNULL(' · ' + h.CustomerName, '') + ISNULL(' · batch ' + l.Batch, ''),
         NULL, h.CreatedBy, 'sale', h.SalesBillingId
  FROM SalesBillingItem l
  JOIN SalesBilling h ON h.SalesBillingId = l.SalesBillingId AND h.IsActive = 1
  WHERE (@itemId IS NULL OR l.ItemId = @itemId)
  UNION ALL
  SELECT l.ItemId, 'sales-return', l.Quantity, h.CreatedAt, h.TransDate,
         'Sales Return ' + ${docNoSql('SR', 'h.SalesReturnId')} + ISNULL(' · ' + h.CustomerName, '') + ISNULL(' · batch ' + l.Batch, ''),
         NULL, h.CreatedBy, 'sales-return', h.SalesReturnId
  FROM SalesReturnItem l
  JOIN SalesReturn h ON h.SalesReturnId = l.SalesReturnId AND h.IsActive = 1
  WHERE (@itemId IS NULL OR l.ItemId = @itemId)
  UNION ALL
  SELECT l.ItemId, 'adjustment', l.InQty - l.OutQty, h.CreatedAt, h.AdjDate,
         'Adjustment ' + ${docNoSql('ADJ', 'h.AdjustmentId')}
           + CASE WHEN l.InQty > 0 THEN ' · in ' + FORMAT(l.InQty, '0.##') ELSE '' END
           + CASE WHEN l.OutQty > 0 THEN ' · out ' + FORMAT(l.OutQty, '0.##') ELSE '' END
           + CASE WHEN l.BatchNo <> '' THEN ' · batch ' + l.BatchNo ELSE '' END + ISNULL(' · ' + h.Remarks, ''),
         NULL, h.CreatedBy, 'stock-adjustment', h.AdjustmentId
  FROM StockAdjustmentItem l
  JOIN StockAdjustment h ON h.AdjustmentId = l.AdjustmentId AND h.IsActive = 1
  WHERE (@itemId IS NULL OR l.ItemId = @itemId)
`;

// Current stock per item (ItemId, CurrentStock) for the items @itemId names,
// or all items when it's NULL. Same sum the Stock Report shows.
export const CURRENT_STOCK = `
  SELECT ItemId, SUM(Qty) AS CurrentStock FROM (${EVENTS}) ev GROUP BY ItemId
`;
