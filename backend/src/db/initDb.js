import { getPool, sql } from './pool.js';
import { hashPassword } from '../utils/password.js';

// Ayush Pharmacy schema. Safe to run again: a table is created only when it's
// missing, so `npm run init-db` never touches existing data. Stock is never
// stored — it's worked out from the documents (see utils/batchStock.js).
// Order: pick-lists, item + vendor, order, stock in / return / payment,
// sales, adjustment, users / menu access / pharmacy details.
const schema = `
-- 1. Pick-lists. Delete only hides a value (IsActive = 0).
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UnitMaster' AND xtype='U')
CREATE TABLE UnitMaster (
    UnitId    INT IDENTITY(1,1) PRIMARY KEY,
    Name      NVARCHAR(50) NOT NULL,
    IsActive  BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='GenericNameMaster' AND xtype='U')
CREATE TABLE GenericNameMaster (
    GenericNameId INT IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(200) NOT NULL,
    IsActive      BIT NOT NULL DEFAULT 1,
    CreatedAt     DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ManufacturerMaster' AND xtype='U')
CREATE TABLE ManufacturerMaster (
    ManufacturerId INT IDENTITY(1,1) PRIMARY KEY,
    Name           NVARCHAR(200) NOT NULL,
    IsActive       BIT NOT NULL DEFAULT 1,
    CreatedAt      DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='CategoryMaster' AND xtype='U')
CREATE TABLE CategoryMaster (
    CategoryId INT IDENTITY(1,1) PRIMARY KEY,
    Name       NVARCHAR(100) NOT NULL,
    SortOrder  INT NOT NULL DEFAULT 0,
    IsActive   BIT NOT NULL DEFAULT 1,
    CreatedAt  DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PotencyMaster' AND xtype='U')
CREATE TABLE PotencyMaster (
    PotencyId  INT IDENTITY(1,1) PRIMARY KEY,
    Name       NVARCHAR(50) NOT NULL,
    SortOrder  INT NOT NULL DEFAULT 0,
    IsActive   BIT NOT NULL DEFAULT 1,
    CreatedAt  DATETIME NOT NULL DEFAULT GETDATE()
);

-- 2. Item master and vendors. ItemCode is ITM + 6 digits of ItemId (not stored).
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PharmacyItem' AND xtype='U')
CREATE TABLE PharmacyItem (
    ItemId          INT IDENTITY(1,1) PRIMARY KEY,
    Name            NVARCHAR(200) NOT NULL,
    UnitId          INT NULL CONSTRAINT FK_PharmacyItem_Unit REFERENCES UnitMaster(UnitId),
    GenericNameId   INT NULL CONSTRAINT FK_PharmacyItem_GenericName REFERENCES GenericNameMaster(GenericNameId),
    ManufacturerId  INT NULL CONSTRAINT FK_PharmacyItem_Manufacturer REFERENCES ManufacturerMaster(ManufacturerId),
    Category        NVARCHAR(100) NULL,
    Potency         NVARCHAR(50) NULL,
    Pack            NVARCHAR(50) NULL,
    HSNCode         NVARCHAR(30) NULL,
    Rack            NVARCHAR(50) NULL,
    BoxNo           NVARCHAR(50) NULL,
    MRP             DECIMAL(10,2) NULL,
    SellPrice       DECIMAL(10,2) NULL,
    PurchaseRate    DECIMAL(10,2) NULL,
    CGSTPercent     DECIMAL(5,2) NULL,
    SGSTPercent     DECIMAL(5,2) NULL,
    GSTPercent      DECIMAL(5,2) NULL,
    ScheduleH       BIT NOT NULL DEFAULT 0,
    ScheduleH1      BIT NOT NULL DEFAULT 0,
    Status          NVARCHAR(10) NOT NULL DEFAULT 'Active',
    IsActive        BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME NOT NULL DEFAULT GETDATE(),
    EditedAt        DATETIME NULL
);

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Vendor' AND xtype='U')
CREATE TABLE Vendor (
    VendorId       INT IDENTITY(1,1) PRIMARY KEY,
    VendorName     NVARCHAR(200) NOT NULL,
    CompanyName    NVARCHAR(200) NULL,
    ContactPerson  NVARCHAR(150) NULL,
    ContactNo      NVARCHAR(20) NULL,
    AlternateNo    NVARCHAR(20) NULL,
    Address        NVARCHAR(500) NULL,
    State          NVARCHAR(60) NULL,
    Pincode        NVARCHAR(6) NULL,
    Email          NVARCHAR(150) NULL,
    GSTNo          NVARCHAR(30) NULL,
    DLNo           NVARCHAR(50) NULL,
    DLNo2          NVARCHAR(50) NULL,
    Status         NVARCHAR(10) NOT NULL DEFAULT 'Active',
    IsActive       BIT NOT NULL DEFAULT 1,
    CreatedAt      DATETIME NOT NULL DEFAULT GETDATE()
);

-- 3. Purchase / Order (no stock change). Lines copy the item's details.
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PurchaseOrder' AND xtype='U')
CREATE TABLE PurchaseOrder (
    PurchaseOrderId INT IDENTITY(1,1) PRIMARY KEY,
    OrderDate       DATE NOT NULL,
    VendorId        INT NOT NULL CONSTRAINT FK_PurchaseOrder_Vendor REFERENCES Vendor(VendorId),
    VendorDetails   NVARCHAR(1000) NULL,
    TotalAmount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    RoundOff        DECIMAL(10,2) NOT NULL DEFAULT 0,
    CreatedBy       NVARCHAR(100) NULL,
    IsActive        BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PurchaseOrderItem' AND xtype='U')
CREATE TABLE PurchaseOrderItem (
    LineId           INT IDENTITY(1,1) PRIMARY KEY,
    PurchaseOrderId  INT NOT NULL CONSTRAINT FK_PurchaseOrderItem_Header REFERENCES PurchaseOrder(PurchaseOrderId) ON DELETE CASCADE,
    ItemId           INT NOT NULL CONSTRAINT FK_PurchaseOrderItem_Item REFERENCES PharmacyItem(ItemId),
    ItemName         NVARCHAR(200) NOT NULL,
    GenericName      NVARCHAR(200) NULL,
    Manufacturer     NVARCHAR(200) NULL,
    HSNCode          NVARCHAR(30) NULL,
    Category         NVARCHAR(100) NULL,
    Pack             NVARCHAR(50) NULL,
    Unit             NVARCHAR(50) NULL,
    MRP              DECIMAL(10,2) NOT NULL,
    PRate            DECIMAL(10,2) NULL,
    DiscPercent      DECIMAL(5,2) NOT NULL DEFAULT 0,
    Rate             DECIMAL(10,2) NOT NULL,
    Quantity         DECIMAL(10,2) NOT NULL,
    FreeQty          DECIMAL(10,2) NOT NULL DEFAULT 0,
    Amount           DECIMAL(12,2) NOT NULL,
    CGSTPercent      DECIMAL(5,2) NOT NULL DEFAULT 0,
    SGSTPercent      DECIMAL(5,2) NOT NULL DEFAULT 0,
    GSTPercent       DECIMAL(5,2) NOT NULL DEFAULT 0,
    GSTAmount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    Total            DECIMAL(12,2) NOT NULL
);

-- 4. Stock In (adds stock, sets the selling price), Return to vendor and
-- Vendor Payment (against one Stock In).
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='StockIn' AND xtype='U')
CREATE TABLE StockIn (
    StockInId        INT IDENTITY(1,1) PRIMARY KEY,
    InDate           DATE NOT NULL,
    VendorId         INT NOT NULL CONSTRAINT FK_StockIn_Vendor REFERENCES Vendor(VendorId),
    PurchaseOrderId  INT NOT NULL CONSTRAINT FK_StockIn_Order REFERENCES PurchaseOrder(PurchaseOrderId),
    CreatedBy        NVARCHAR(100) NULL,
    IsActive         BIT NOT NULL DEFAULT 1,
    CreatedAt        DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='StockInItem' AND xtype='U')
CREATE TABLE StockInItem (
    LineId        INT IDENTITY(1,1) PRIMARY KEY,
    StockInId     INT NOT NULL CONSTRAINT FK_StockInItem_Header REFERENCES StockIn(StockInId) ON DELETE CASCADE,
    PoLineId      INT NOT NULL CONSTRAINT FK_StockInItem_PoLine REFERENCES PurchaseOrderItem(LineId),
    ItemId        INT NOT NULL CONSTRAINT FK_StockInItem_Item REFERENCES PharmacyItem(ItemId),
    BatchNo       NVARCHAR(50) NOT NULL,
    MfgDate       DATE NULL,
    ExpDate       DATE NOT NULL,
    Quantity      DECIMAL(10,2) NOT NULL,
    FreeQty       DECIMAL(10,2) NOT NULL DEFAULT 0,
    Rate          DECIMAL(10,2) NOT NULL,
    MRP           DECIMAL(10,2) NOT NULL,
    SalesPercent  DECIMAL(6,2) NOT NULL DEFAULT 0,
    DiscPercent   DECIMAL(5,2) NOT NULL DEFAULT 0,
    SelAmount     DECIMAL(10,2) NOT NULL
);

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='StockReturn' AND xtype='U')
CREATE TABLE StockReturn (
    StockReturnId  INT IDENTITY(1,1) PRIMARY KEY,
    ReturnDate     DATE NOT NULL,
    VendorId       INT NOT NULL CONSTRAINT FK_StockReturn_Vendor REFERENCES Vendor(VendorId),
    StockInId      INT NOT NULL CONSTRAINT FK_StockReturn_StockIn REFERENCES StockIn(StockInId),
    TotalAmount    DECIMAL(12,2) NOT NULL DEFAULT 0,
    CreatedBy      NVARCHAR(100) NULL,
    IsActive       BIT NOT NULL DEFAULT 1,
    CreatedAt      DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='StockReturnItem' AND xtype='U')
CREATE TABLE StockReturnItem (
    LineId          INT IDENTITY(1,1) PRIMARY KEY,
    StockReturnId   INT NOT NULL CONSTRAINT FK_StockReturnItem_Header REFERENCES StockReturn(StockReturnId) ON DELETE CASCADE,
    StockInLineId   INT NOT NULL CONSTRAINT FK_StockReturnItem_InLine REFERENCES StockInItem(LineId),
    ItemId          INT NOT NULL CONSTRAINT FK_StockReturnItem_Item REFERENCES PharmacyItem(ItemId),
    BatchNo         NVARCHAR(50) NOT NULL,
    MfgDate         DATE NULL,
    ExpDate         DATE NULL,
    Rate            DECIMAL(10,2) NOT NULL,
    Quantity        DECIMAL(10,2) NOT NULL,
    Amount          DECIMAL(12,2) NOT NULL
);

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='VendorPayment' AND xtype='U')
CREATE TABLE VendorPayment (
    PaymentId      INT IDENTITY(1,1) PRIMARY KEY,
    VendorId       INT NOT NULL CONSTRAINT FK_VendorPayment_Vendor REFERENCES Vendor(VendorId),
    StockInId      INT NOT NULL CONSTRAINT FK_VendorPayment_StockIn REFERENCES StockIn(StockInId),
    PayDate        DATE NOT NULL,
    Amount         DECIMAL(12,2) NOT NULL,
    PayMode        NVARCHAR(20) NOT NULL,
    ReferenceNo    NVARCHAR(50) NULL,
    Notes          NVARCHAR(300) NULL,
    CreatedBy      NVARCHAR(100) NULL,
    IsActive       BIT NOT NULL DEFAULT 1,
    CreatedAt      DATETIME NOT NULL DEFAULT GETDATE()
);

-- 5. Sales (counter sale) and Sales Return. Quantity is in packs (DECIMAL
-- 12,4 so a Unit sale of 5 from a 15's strip is exactly 0.3333).
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SalesBilling' AND xtype='U')
CREATE TABLE SalesBilling (
    SalesBillingId  INT IDENTITY(1,1) PRIMARY KEY,
    TransDate       DATE NOT NULL,
    CustomerName    NVARCHAR(200) NULL,
    MobileNo        NVARCHAR(20) NULL,
    SubTotal        DECIMAL(12,2) NULL,
    DiscPercent     DECIMAL(5,2) NOT NULL DEFAULT 0,
    DiscountAmount  DECIMAL(12,2) NOT NULL DEFAULT 0,
    RoundOff        DECIMAL(10,2) NOT NULL DEFAULT 0,
    TotalAmount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    CreatedBy       NVARCHAR(100) NULL,
    IsActive        BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SalesBillingItem' AND xtype='U')
CREATE TABLE SalesBillingItem (
    LineId          INT IDENTITY(1,1) PRIMARY KEY,
    SalesBillingId  INT NOT NULL CONSTRAINT FK_SalesBillingItem_Header REFERENCES SalesBilling(SalesBillingId) ON DELETE CASCADE,
    ItemId          INT NOT NULL CONSTRAINT FK_SalesBillingItem_Item REFERENCES PharmacyItem(ItemId),
    Batch           NVARCHAR(100) NULL,
    ExpiryDate      DATE NULL,
    SaleUnit        NVARCHAR(10) NULL,
    UnitQty         DECIMAL(10,2) NULL,
    PackSize        INT NULL,
    Quantity        DECIMAL(12,4) NOT NULL,
    Rate            DECIMAL(10,2) NOT NULL,
    DiscPercent     DECIMAL(5,2) NOT NULL DEFAULT 0,
    Amount          DECIMAL(12,2) NOT NULL
);

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SalesReturn' AND xtype='U')
CREATE TABLE SalesReturn (
    SalesReturnId   INT IDENTITY(1,1) PRIMARY KEY,
    TransDate       DATE NOT NULL,
    SalesBillingId  INT NULL,
    CustomerName    NVARCHAR(200) NULL,
    MobileNo        NVARCHAR(20) NULL,
    SubTotal        DECIMAL(12,2) NULL,
    DiscPercent     DECIMAL(5,2) NOT NULL DEFAULT 0,
    DiscountAmount  DECIMAL(12,2) NOT NULL DEFAULT 0,
    TotalAmount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    CreatedBy       NVARCHAR(100) NULL,
    IsActive        BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SalesReturnItem' AND xtype='U')
CREATE TABLE SalesReturnItem (
    LineId         INT IDENTITY(1,1) PRIMARY KEY,
    SalesReturnId  INT NOT NULL CONSTRAINT FK_SalesReturnItem_Header REFERENCES SalesReturn(SalesReturnId) ON DELETE CASCADE,
    SalesLineId    INT NULL,
    ItemId         INT NOT NULL CONSTRAINT FK_SalesReturnItem_Item REFERENCES PharmacyItem(ItemId),
    Batch          NVARCHAR(100) NULL,
    ExpiryDate     DATE NULL,
    SaleUnit       NVARCHAR(10) NULL,
    UnitQty        DECIMAL(10,2) NULL,
    PackSize       INT NULL,
    Quantity       DECIMAL(12,4) NOT NULL,
    Rate           DECIMAL(10,2) NOT NULL,
    DiscPercent    DECIMAL(5,2) NOT NULL DEFAULT 0,
    Amount         DECIMAL(12,2) NOT NULL
);

-- 6. Stock Adjustment: corrections and opening stock (Adjust In).
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='StockAdjustment' AND xtype='U')
CREATE TABLE StockAdjustment (
    AdjustmentId INT IDENTITY(1,1) PRIMARY KEY,
    AdjDate      DATE NOT NULL,
    Remarks      NVARCHAR(300) NULL,
    InTotal      DECIMAL(12,2) NOT NULL DEFAULT 0,
    OutTotal     DECIMAL(12,2) NOT NULL DEFAULT 0,
    CreatedBy    NVARCHAR(100) NULL,
    IsActive     BIT NOT NULL DEFAULT 1,
    CreatedAt    DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='StockAdjustmentItem' AND xtype='U')
CREATE TABLE StockAdjustmentItem (
    LineId       INT IDENTITY(1,1) PRIMARY KEY,
    AdjustmentId INT NOT NULL CONSTRAINT FK_StockAdjustmentItem_Header REFERENCES StockAdjustment(AdjustmentId),
    ItemId       INT NOT NULL CONSTRAINT FK_StockAdjustmentItem_Item REFERENCES PharmacyItem(ItemId),
    BatchNo      NVARCHAR(100) NOT NULL DEFAULT '',
    CurStock     DECIMAL(12,4) NOT NULL DEFAULT 0,
    InQty        DECIMAL(10,2) NOT NULL DEFAULT 0,
    InPrice      DECIMAL(10,2) NOT NULL DEFAULT 0,
    OutQty       DECIMAL(10,2) NOT NULL DEFAULT 0,
    OutPrice     DECIMAL(10,2) NOT NULL DEFAULT 0,
    MRP          DECIMAL(10,2) NULL
);

-- 7. Users, menu access and the pharmacy's own details.
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AppUser' AND xtype='U')
CREATE TABLE AppUser (
    UserId        INT IDENTITY(1,1) PRIMARY KEY,
    Username      NVARCHAR(100) NOT NULL UNIQUE,
    PasswordHash  NVARCHAR(256) NOT NULL,
    Role          NVARCHAR(20) NOT NULL DEFAULT 'Staff',
    IsActive      BIT NOT NULL DEFAULT 1,
    CreatedAt     DATETIME NOT NULL DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MenuAccess' AND xtype='U')
CREATE TABLE MenuAccess (
    AccessId     INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT NOT NULL CONSTRAINT FK_MenuAccess_User REFERENCES AppUser(UserId) ON DELETE CASCADE,
    MenuKey      NVARCHAR(100) NOT NULL,
    AccessLevel  NVARCHAR(20) NOT NULL DEFAULT 'No Access',
    CONSTRAINT UQ_MenuAccess UNIQUE (UserId, MenuKey)
);
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ClinicDetails' AND xtype='U')
CREATE TABLE ClinicDetails (
    ClinicId   INT PRIMARY KEY,
    Name       NVARCHAR(200) NOT NULL DEFAULT '',
    Address    NVARCHAR(500) NULL,
    ContactNo  NVARCHAR(20) NULL,
    Email      NVARCHAR(200) NULL,
    Logo       NVARCHAR(MAX) NULL,
    AppName    NVARCHAR(100) NULL,
    UpdatedAt  DATETIME NOT NULL DEFAULT GETDATE()
);
`;

// Batch stock lookups (utils/batchStock.js) search every received /
// returned / sold line by item when an item is picked on Sales.
const indexes = `
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_StockInItem_ItemId')
    CREATE INDEX IX_StockInItem_ItemId ON StockInItem (ItemId) INCLUDE (StockInId, BatchNo, ExpDate, Quantity, FreeQty);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_StockReturnItem_ItemId')
    CREATE INDEX IX_StockReturnItem_ItemId ON StockReturnItem (ItemId) INCLUDE (StockReturnId, BatchNo, Quantity);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_SalesBillingItem_ItemId')
    CREATE INDEX IX_SalesBillingItem_ItemId ON SalesBillingItem (ItemId) INCLUDE (SalesBillingId, Batch, Quantity);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_SalesReturnItem_ItemId')
    CREATE INDEX IX_SalesReturnItem_ItemId ON SalesReturnItem (ItemId) INCLUDE (SalesReturnId, Batch, Quantity);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_StockAdjustmentItem_ItemId')
    CREATE INDEX IX_StockAdjustmentItem_ItemId ON StockAdjustmentItem (ItemId) INCLUDE (AdjustmentId, BatchNo, InQty, OutQty);
`;

// Starting pick-list values; only names not already there are added.
const UNIT_SEED = ['1', '10', '15', '30', 'nos', 'bottle', 'strip', 'tablet', 'ml', 'gm', 'dram', 'box', 'tube', 'sachet'];
const POTENCY_SEED = ['6C', '30C', '200C', '1M', '10M', 'Q'];
const CATEGORY_SEED = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops', 'Ointment', 'Cream', 'Powder', 'Dilution', 'Mother Tincture', 'Surgical', 'Others'];

async function init() {
  try {
    const pool = await getPool();
    await pool.request().batch(schema);
    await pool.request().batch(indexes);

    for (const name of UNIT_SEED) {
      await pool.request().input('name', sql.NVarChar, name).query(`
        IF NOT EXISTS (SELECT * FROM UnitMaster WHERE LOWER(Name) = LOWER(@name))
          INSERT INTO UnitMaster (Name) VALUES (@name)
      `);
    }
    for (const [i, name] of POTENCY_SEED.entries()) {
      await pool.request().input('name', sql.NVarChar, name).input('sort', sql.Int, i + 1).query(`
        IF NOT EXISTS (SELECT * FROM PotencyMaster WHERE LOWER(Name) = LOWER(@name))
          INSERT INTO PotencyMaster (Name, SortOrder) VALUES (@name, @sort)
      `);
    }
    for (const name of CATEGORY_SEED) {
      await pool.request().input('name', sql.NVarChar, name).query(`
        IF NOT EXISTS (SELECT * FROM CategoryMaster WHERE LOWER(Name) = LOWER(@name))
          INSERT INTO CategoryMaster (Name) VALUES (@name)
      `);
    }

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM ClinicDetails WHERE ClinicId = 1)
        INSERT INTO ClinicDetails (ClinicId, Name, AppName) VALUES (1, 'Ayush Pharmacy', 'Ayush Pharmacy')
    `);

    // Seed the default Admin user only if it doesn't already exist.
    const exists = await pool.request().input('u', sql.NVarChar, 'Admin')
      .query('SELECT COUNT(*) AS n FROM AppUser WHERE Username = @u');
    if (exists.recordset[0].n === 0) {
      await pool.request()
        .input('u', sql.NVarChar, 'Admin')
        .input('p', sql.NVarChar, hashPassword('Admin@1'))
        .query(`INSERT INTO AppUser (Username, PasswordHash, Role, IsActive) VALUES (@u, @p, 'Admin', 1)`);
      console.log('Seeded default user: Admin');
    }

    console.log('Schema initialized successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Schema init failed:', err.message);
    process.exit(1);
  }
}

init();
