import * as ExcelJS from 'exceljs';

type ColumnDef = {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
};

const VND_FMT = '#,##0 "₫"';
const INT_FMT = '#,##0';
const PCT_FMT = '0.0"%"';

function applyHeaderStyle(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function buildSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: ColumnDef[],
  rows: Record<string, unknown>[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));
  for (const r of rows) {
    sheet.addRow(r);
  }
  applyHeaderStyle(sheet);
  return sheet;
}

export function buildWorkbook(type: string, data: any): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bookstore Admin';
  workbook.created = new Date();

  switch (type) {
    case 'revenue': {
      const points: Array<{
        date: string;
        revenue: number;
        orderCount: number;
        codRevenue?: number;
        vnpayRevenue?: number;
      }> = data?.points ?? [];
      const cols: ColumnDef[] = [
        { header: 'Ngày', key: 'date', width: 15 },
        { header: 'Doanh thu', key: 'revenue', width: 18, numFmt: VND_FMT },
        { header: 'Số đơn', key: 'orderCount', width: 12, numFmt: INT_FMT },
        { header: 'COD', key: 'codRevenue', width: 18, numFmt: VND_FMT },
        { header: 'VNPay', key: 'vnpayRevenue', width: 18, numFmt: VND_FMT },
      ];
      buildSheet(
        workbook,
        'Doanh thu',
        cols,
        points.map((p) => ({
          date: p.date,
          revenue: p.revenue ?? 0,
          orderCount: p.orderCount ?? 0,
          codRevenue: p.codRevenue ?? 0,
          vnpayRevenue: p.vnpayRevenue ?? 0,
        })),
      );
      break;
    }

    case 'top-products': {
      const items: Array<any> = Array.isArray(data) ? data : data?.items ?? [];
      const cols: ColumnDef[] = [
        { header: 'Hạng', key: 'rank', width: 8, numFmt: INT_FMT },
        { header: 'Tên sách', key: 'title', width: 40 },
        { header: 'Tác giả', key: 'authorName', width: 24 },
        { header: 'Danh mục', key: 'categoryName', width: 20 },
        { header: 'Số lượng bán', key: 'unitsSold', width: 14, numFmt: INT_FMT },
        { header: 'Doanh thu', key: 'revenue', width: 18, numFmt: VND_FMT },
        { header: 'Giá TB', key: 'avgPrice', width: 14, numFmt: VND_FMT },
        { header: 'Tồn kho', key: 'stockQuantity', width: 12, numFmt: INT_FMT },
      ];
      buildSheet(
        workbook,
        'Top sản phẩm',
        cols,
        items.map((it, idx) => ({
          rank: idx + 1,
          title: it.title,
          authorName: it.authorName ?? '',
          categoryName: it.categoryName ?? '',
          unitsSold: it.unitsSold ?? 0,
          revenue: it.revenue ?? 0,
          avgPrice: it.avgPrice ?? 0,
          stockQuantity: it.stockQuantity ?? 0,
        })),
      );
      break;
    }

    case 'customers-top': {
      const items: Array<any> = Array.isArray(data) ? data : [];
      const cols: ColumnDef[] = [
        { header: 'Hạng', key: 'rank', width: 8, numFmt: INT_FMT },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Họ và tên', key: 'fullName', width: 28 },
        { header: 'Số đơn', key: 'orderCount', width: 12, numFmt: INT_FMT },
        { header: 'Tổng chi tiêu', key: 'totalSpent', width: 18, numFmt: VND_FMT },
        { header: 'Đơn gần nhất', key: 'lastOrderAt', width: 22 },
      ];
      buildSheet(
        workbook,
        'Khách hàng top',
        cols,
        items.map((it, idx) => ({
          rank: idx + 1,
          email: it.email ?? '',
          fullName: it.fullName ?? '',
          orderCount: it.orderCount ?? 0,
          totalSpent: it.totalSpent ?? 0,
          lastOrderAt: it.lastOrderAt
            ? new Date(it.lastOrderAt).toISOString()
            : '',
        })),
      );
      break;
    }

    case 'inventory-detail': {
      const items: Array<any> = Array.isArray(data) ? data : [];
      const cols: ColumnDef[] = [
        { header: 'Tên sách', key: 'title', width: 40 },
        { header: 'ISBN', key: 'isbn', width: 18 },
        { header: 'Danh mục', key: 'categoryName', width: 20 },
        {
          header: 'Tồn kho',
          key: 'stockQuantity',
          width: 12,
          numFmt: INT_FMT,
        },
        { header: 'Giá', key: 'price', width: 16, numFmt: VND_FMT },
        { header: 'Giá trị', key: 'value', width: 18, numFmt: VND_FMT },
      ];
      buildSheet(
        workbook,
        'Tồn kho',
        cols,
        items.map((it) => ({
          title: it.title ?? '',
          isbn: it.isbn ?? '',
          categoryName: it.categoryName ?? '',
          stockQuantity: it.stockQuantity ?? 0,
          price: it.price ?? 0,
          value: it.value ?? 0,
        })),
      );
      break;
    }

    case 'voucher-usage': {
      const items: Array<any> = Array.isArray(data) ? data : [];
      const cols: ColumnDef[] = [
        { header: 'Mã', key: 'code', width: 18 },
        { header: 'Loại', key: 'type', width: 16 },
        { header: 'Giá trị', key: 'value', width: 14 },
        { header: 'Đã dùng', key: 'usedCount', width: 12, numFmt: INT_FMT },
        {
          header: 'Tổng lượt',
          key: 'totalQuantity',
          width: 12,
          numFmt: INT_FMT,
        },
        {
          header: 'Tổng giảm giá',
          key: 'totalDiscount',
          width: 18,
          numFmt: VND_FMT,
        },
        {
          header: 'Còn lại (%)',
          key: 'remainingPct',
          width: 14,
          numFmt: PCT_FMT,
        },
      ];
      buildSheet(
        workbook,
        'Sử dụng voucher',
        cols,
        items.map((it) => ({
          code: it.code ?? '',
          type: it.type ?? '',
          value: it.value ?? '',
          usedCount: it.usedCount ?? 0,
          totalQuantity: it.totalQuantity ?? 0,
          totalDiscount: it.totalDiscount ?? 0,
          remainingPct: it.remainingPct ?? 0,
        })),
      );
      break;
    }

    case 'orders-status': {
      const items: Array<any> = Array.isArray(data) ? data : [];
      const cols: ColumnDef[] = [
        { header: 'Trạng thái', key: 'status', width: 20 },
        { header: 'Số đơn', key: 'count', width: 12, numFmt: INT_FMT },
        { header: 'Tỷ lệ (%)', key: 'pct', width: 14, numFmt: PCT_FMT },
      ];
      buildSheet(
        workbook,
        'Trạng thái đơn',
        cols,
        items.map((it) => ({
          status: it.status ?? '',
          count: it.count ?? 0,
          pct: it.pct ?? 0,
        })),
      );
      break;
    }

    default: {
      const sheet = workbook.addWorksheet('data');
      sheet.addRow(['Không có dữ liệu cho loại: ' + type]);
    }
  }

  return workbook;
}
