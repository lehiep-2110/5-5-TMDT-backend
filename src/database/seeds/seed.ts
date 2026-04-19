import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import slugify from 'slugify';
import dataSource from '../../config/typeorm.config';
import { User } from '../entities/user.entity';
import { Address } from '../entities/address.entity';
import { Author } from '../entities/author.entity';
import { Publisher } from '../entities/publisher.entity';
import { Category } from '../entities/category.entity';
import { Book } from '../entities/book.entity';
import { BookAuthor } from '../entities/book-author.entity';
import { BookImage } from '../entities/book-image.entity';
import { StockLog } from '../entities/stock-log.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { BookStatus } from '../../common/enums/book-status.enum';
import { StockReason } from '../../common/enums/stock-reason.enum';

const SALT_ROUNDS = 10;

function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, locale: 'vi' });
}

async function upsertUser(
  email: string,
  fullName: string,
  password: string,
  role: UserRole,
  phone?: string,
): Promise<User> {
  const repo = dataSource.getRepository(User);
  let user = await repo.findOne({ where: { email } });
  if (user) return user;
  user = repo.create({
    email,
    fullName,
    passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    role,
    status: UserStatus.ACTIVE,
    phone: phone ?? null,
  });
  return repo.save(user);
}

async function ensureAddress(userId: string, recipientName: string, phone: string): Promise<void> {
  const repo = dataSource.getRepository(Address);
  const exists = await repo.findOne({ where: { userId } });
  if (exists) return;
  await repo.save(
    repo.create({
      userId,
      recipientName,
      phone,
      province: 'Hà Nội',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      streetAddress: 'Số 1, Đường Xuân Thủy',
      isDefault: true,
    }),
  );
}

async function upsertAuthor(name: string, nationality: string): Promise<Author> {
  const repo = dataSource.getRepository(Author);
  let author = await repo.findOne({ where: { name } });
  if (author) return author;
  author = repo.create({ name, nationality, biography: null, avatarUrl: null });
  return repo.save(author);
}

async function upsertPublisher(name: string): Promise<Publisher> {
  const repo = dataSource.getRepository(Publisher);
  let pub = await repo.findOne({ where: { name } });
  if (pub) return pub;
  pub = repo.create({ name, address: null, website: null, logoUrl: null });
  return repo.save(pub);
}

async function upsertCategory(
  name: string,
  parentId: string | null,
  displayOrder: number,
): Promise<Category> {
  const repo = dataSource.getRepository(Category);
  const slug = toSlug(name);
  let cat = await repo.findOne({ where: { slug } });
  if (cat) return cat;
  cat = repo.create({
    name,
    slug,
    parentId,
    description: null,
    imageUrl: null,
    isActive: true,
    displayOrder,
  });
  return repo.save(cat);
}

async function upsertBook(params: {
  title: string;
  isbn: string;
  publisherId: string;
  categoryId: string;
  authorIds: string[];
  price: number;
  stock: number;
  description: string;
  yearPublished: number;
  language: string;
  createdBy: string;
}): Promise<void> {
  const bookRepo = dataSource.getRepository(Book);
  const bookAuthorRepo = dataSource.getRepository(BookAuthor);
  const bookImageRepo = dataSource.getRepository(BookImage);
  const stockLogRepo = dataSource.getRepository(StockLog);

  const slug = toSlug(params.title);
  let book = await bookRepo.findOne({ where: { slug } });
  if (book) return;

  book = bookRepo.create({
    title: params.title,
    slug,
    isbn: params.isbn,
    publisherId: params.publisherId,
    categoryId: params.categoryId,
    language: params.language,
    yearPublished: params.yearPublished,
    price: params.price.toFixed(2),
    description: params.description,
    pages: 200,
    dimensions: '14x20 cm',
    weight: '0.30',
    stockQuantity: params.stock,
    status: BookStatus.ACTIVE,
    avgRating: '0.00',
    reviewCount: 0,
  });
  book = await bookRepo.save(book);

  for (const authorId of params.authorIds) {
    await bookAuthorRepo.save(bookAuthorRepo.create({ bookId: book.id, authorId }));
  }

  await bookImageRepo.save(
    bookImageRepo.create({
      bookId: book.id,
      imageUrl: `https://via.placeholder.com/300x400?text=${encodeURIComponent(params.title.slice(0, 20))}`,
      isPrimary: true,
      displayOrder: 0,
    }),
  );

  await stockLogRepo.save(
    stockLogRepo.create({
      bookId: book.id,
      changeAmount: params.stock,
      newQuantity: params.stock,
      reason: StockReason.INITIAL_IMPORT,
      orderId: null,
      createdBy: params.createdBy,
      note: 'Nhập kho ban đầu',
    }),
  );
}

async function run() {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  // 1. Users
  const admin = await upsertUser(
    'admin@bookstore.vn',
    'Quản trị viên',
    'Admin@123',
    UserRole.ADMIN,
    '0900000001',
  );
  const staff = await upsertUser(
    'staff@bookstore.vn',
    'Nhân viên kho',
    'Staff@123',
    UserRole.WAREHOUSE_STAFF,
    '0900000002',
  );

  const customers: User[] = [];
  for (let i = 1; i <= 3; i++) {
    const c = await upsertUser(
      `customer${i}@test.com`,
      `Khách hàng ${i}`,
      'Customer@123',
      UserRole.CUSTOMER,
      `09000000${10 + i}`,
    );
    customers.push(c);
    await ensureAddress(c.id, `Khách hàng ${i}`, `09000000${10 + i}`);
  }

  // 2. Authors
  const a1 = await upsertAuthor('Nguyễn Nhật Ánh', 'Việt Nam');
  const a2 = await upsertAuthor('Tô Hoài', 'Việt Nam');
  const a3 = await upsertAuthor('Paulo Coelho', 'Brazil');

  // 3. Publishers
  const p1 = await upsertPublisher('NXB Trẻ');
  const p2 = await upsertPublisher('NXB Kim Đồng');

  // 4. Categories
  const vanHoc = await upsertCategory('Văn học', null, 1);
  const tieuThuyet = await upsertCategory('Tiểu thuyết', vanHoc.id, 2);
  const truyenNgan = await upsertCategory('Truyện ngắn', vanHoc.id, 3);
  const thieuNhi = await upsertCategory('Thiếu nhi', null, 4);
  const truyenTranh = await upsertCategory('Truyện tranh', thieuNhi.id, 5);
  const kinhTe = await upsertCategory('Kinh tế', null, 6);

  // 5. Books — 15 books
  const books: Array<{
    title: string;
    cat: Category;
    pub: Publisher;
    author: Author;
    price: number;
    stock: number;
    year: number;
    desc: string;
  }> = [
    { title: 'Cho tôi xin một vé đi tuổi thơ', cat: tieuThuyet, pub: p1, author: a1, price: 85000, stock: 50, year: 2008, desc: 'Cuốn sách đưa bạn trở về tuổi thơ.' },
    { title: 'Mắt biếc', cat: tieuThuyet, pub: p1, author: a1, price: 95000, stock: 80, year: 1990, desc: 'Câu chuyện tình buồn của Ngạn và Hà Lan.' },
    { title: 'Kính vạn hoa tập 1', cat: truyenTranh, pub: p2, author: a1, price: 60000, stock: 100, year: 1995, desc: 'Tập đầu tiên bộ Kính vạn hoa.' },
    { title: 'Tôi thấy hoa vàng trên cỏ xanh', cat: tieuThuyet, pub: p1, author: a1, price: 110000, stock: 40, year: 2010, desc: 'Tiểu thuyết nổi tiếng đã được chuyển thể điện ảnh.' },
    { title: 'Cô gái đến từ hôm qua', cat: truyenNgan, pub: p1, author: a1, price: 75000, stock: 30, year: 1989, desc: 'Tác phẩm kinh điển của Nguyễn Nhật Ánh.' },
    { title: 'Dế Mèn phiêu lưu ký', cat: thieuNhi, pub: p2, author: a2, price: 70000, stock: 90, year: 1941, desc: 'Cuộc phiêu lưu của chú dế mèn.' },
    { title: 'Vợ chồng A Phủ', cat: truyenNgan, pub: p1, author: a2, price: 65000, stock: 25, year: 1953, desc: 'Truyện ngắn nổi tiếng về Tây Bắc.' },
    { title: 'O chuột', cat: truyenNgan, pub: p1, author: a2, price: 55000, stock: 20, year: 1942, desc: 'Tập truyện ngắn đầu tay của Tô Hoài.' },
    { title: 'Nhà giả kim', cat: tieuThuyet, pub: p1, author: a3, price: 120000, stock: 100, year: 1988, desc: 'Hành trình tìm kho báu và chính mình.' },
    { title: 'Người đàn bà ở Stockholm', cat: tieuThuyet, pub: p1, author: a3, price: 135000, stock: 60, year: 2014, desc: 'Tác phẩm lãng mạn của Paulo Coelho.' },
    { title: 'Veronika quyết chết', cat: tieuThuyet, pub: p1, author: a3, price: 115000, stock: 45, year: 1998, desc: 'Câu chuyện về ý nghĩa cuộc sống.' },
    { title: 'Bí quyết làm giàu', cat: kinhTe, pub: p1, author: a3, price: 150000, stock: 70, year: 2005, desc: 'Những bài học tài chính cá nhân.' },
    { title: 'Khởi nghiệp tinh gọn', cat: kinhTe, pub: p1, author: a1, price: 180000, stock: 35, year: 2015, desc: 'Cẩm nang khởi nghiệp thực tế.' },
    { title: 'Thương nhớ mười hai', cat: truyenNgan, pub: p2, author: a2, price: 90000, stock: 55, year: 1972, desc: 'Tản văn về Hà Nội xưa.' },
    { title: 'Tuổi thơ dữ dội', cat: thieuNhi, pub: p2, author: a2, price: 100000, stock: 65, year: 1988, desc: 'Cuộc sống của các chiến sĩ thiếu niên.' },
  ];

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const isbn = `97860400000${String(i).padStart(2, '0')}`.slice(0, 13);
    await upsertBook({
      title: b.title,
      isbn,
      publisherId: b.pub.id,
      categoryId: b.cat.id,
      authorIds: [b.author.id],
      price: b.price,
      stock: b.stock,
      description: b.desc,
      yearPublished: b.year,
      language: 'Tieng Viet',
      createdBy: admin.id,
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seed completed. admin=${admin.email}, staff=${staff.email}, customers=${customers.length}`,
  );

  await dataSource.destroy();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
