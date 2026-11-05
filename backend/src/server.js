import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import manifestRoutes from './routes/manifest.js';
import appInfoRoutes from './routes/appInfo.js';
import userRoutes from './routes/user.js';
import menuAccessRoutes from './routes/menuAccess.js';
import clinicRoutes from './routes/clinic.js';
import vendorRoutes from './routes/vendor.js';
import pharmacyItemRoutes from './routes/pharmacyItem.js';
import pharmacyReportRoutes from './routes/pharmacyReport.js';
import itemMasterRoutes from './routes/itemMaster.js';
import purchaseOrderRoutes from './routes/purchaseOrder.js';
import stockInRoutes from './routes/stockIn.js';
import vendorPaymentRoutes from './routes/vendorPayment.js';
import stockReturnRoutes from './routes/stockReturn.js';
import stockAdjustmentRoutes from './routes/stockAdjustment.js';
import salesBillingRoutes from './routes/salesBilling.js';
import salesReturnRoutes from './routes/salesReturn.js';
import dashboardRoutes from './routes/dashboard.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api/auth', authRoutes);
// Public: the manifest and app name must be fetchable before login.
app.use('/api', manifestRoutes);
app.use('/api', appInfoRoutes);

app.use('/api', requireAuth);

app.use('/api/users', userRoutes);
app.use('/api/menu-access', menuAccessRoutes);
app.use('/api/clinic', clinicRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/pharmacy-items', pharmacyItemRoutes);
app.use('/api/pharmacy-reports', pharmacyReportRoutes);
app.use('/api/item-master', itemMasterRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/stock-ins', stockInRoutes);
app.use('/api/vendor-bill-payments', vendorPaymentRoutes);
app.use('/api/stock-returns', stockReturnRoutes);
app.use('/api/stock-adjustments', stockAdjustmentRoutes);
app.use('/api/sales-billings', salesBillingRoutes);
app.use('/api/sales-returns', salesReturnRoutes);
app.use('/api/dashboard', dashboardRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
