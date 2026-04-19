import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
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
import { PriceHistory } from '../entities/price-history.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { BookStatus } from '../../common/enums/book-status.enum';
import { StockReason } from '../../common/enums/stock-reason.enum';

const SALT_ROUNDS = 10;
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', '..', 'uploads', 'books');

function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, locale: 'vi' });
}

// Deterministic pseudo-random helpers so reseeds are stable.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRand(seed: string): () => number {
  let x = hashString(seed) || 1;
  return () => {
    // Mulberry32
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrap by words, target chars per line ~14
function wrapTitle(title: string, maxChars = 14, maxLines = 4): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current.length) {
      current = w;
    } else if ((current + ' ' + w).length <= maxChars) {
      current = current + ' ' + w;
    } else {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // If last line overflowed into remaining words, append ellipsis
  return lines;
}

const COVER_PALETTE = [
  '#1F2937',
  '#7C2D12',
  '#14532D',
  '#111827',
  '#7F1D1D',
  '#312E81',
  '#134E4A',
  '#78350F',
  '#1E293B',
  '#4C1D95',
];

function buildCoverSvg(title: string, author: string): string {
  const bg = COVER_PALETTE[hashString(title) % COVER_PALETTE.length];
  const titleLines = wrapTitle(title, 14, 4);
  const lineCount = titleLines.length;
  const lineHeight = 64;
  const titleBlockHeight = lineCount * lineHeight;
  const titleStartY = 400 - titleBlockHeight / 2 + 50; // visually centered
  const tspans = titleLines
    .map(
      (ln, i) =>
        `<tspan x="300" dy="${i === 0 ? 0 : lineHeight}">${xmlEscape(ln)}</tspan>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <rect width="600" height="800" fill="${bg}"/>
  <rect x="28" y="28" width="544" height="744" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="300" y="120" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="16" letter-spacing="2" opacity="0.8" style="text-transform:uppercase;">${xmlEscape(author.toUpperCase())}</text>
  <line x1="200" y1="150" x2="400" y2="150" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
  <text x="300" y="${titleStartY}" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="44" font-weight="700">${tspans}</text>
  <text x="300" y="740" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="12" letter-spacing="4" opacity="0.7">THE EDITORIAL</text>
</svg>
`;
}

function cleanupBrokenUploads(): number {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    return 0;
  }
  let removed = 0;
  const files = fs.readdirSync(UPLOADS_DIR);
  for (const f of files) {
    const full = path.join(UPLOADS_DIR, f);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const isFake = /-fake\.(png|jpg|jpeg)$/i.test(f);
      const isTiny = st.size < 100;
      if (isFake || isTiny) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch {
      // ignore
    }
  }
  return removed;
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

interface BookSeed {
  title: string;
  authorNames: string[];
  publisherName: string;
  categorySlug: string;
  desc: string;
}

const BOOK_SEED: BookSeed[] = [
  // Văn học Việt Nam
  {
    title: 'Tôi thấy hoa vàng trên cỏ xanh',
    authorNames: ['Nguyễn Nhật Ánh'],
    publisherName: 'NXB Trẻ',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Tiểu thuyết nổi tiếng của Nguyễn Nhật Ánh đã được chuyển thể thành phim điện ảnh. Câu chuyện mộc mạc về tuổi thơ ở một miền quê Việt Nam đầy màu sắc và cảm xúc.',
  },
  {
    title: 'Mắt biếc',
    authorNames: ['Nguyễn Nhật Ánh'],
    publisherName: 'NXB Trẻ',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Câu chuyện tình yêu buồn của Ngạn và Hà Lan bên cạnh làng Đo Đo. Một trong những tác phẩm để đời của Nguyễn Nhật Ánh.',
  },
  {
    title: 'Cho tôi xin một vé đi tuổi thơ',
    authorNames: ['Nguyễn Nhật Ánh'],
    publisherName: 'NXB Trẻ',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Cuốn sách đưa bạn trở về những ký ức tuổi thơ tươi đẹp. Tác phẩm đã đoạt giải thưởng văn học ASEAN năm 2010.',
  },
  {
    title: 'Cô gái đến từ hôm qua',
    authorNames: ['Nguyễn Nhật Ánh'],
    publisherName: 'NXB Trẻ',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Câu chuyện dễ thương của Thư và Việt An thời tiểu học. Một tác phẩm kinh điển về tình yêu tuổi học trò của Nguyễn Nhật Ánh.',
  },
  {
    title: 'Dế mèn phiêu lưu ký',
    authorNames: ['Tô Hoài'],
    publisherName: 'NXB Kim Đồng',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Hành trình phiêu lưu của chú dế mèn khắp muôn nơi. Một tác phẩm văn học thiếu nhi bất hủ của Việt Nam đã được dịch ra hàng chục thứ tiếng.',
  },
  {
    title: 'Vợ nhặt',
    authorNames: ['Kim Lân'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Truyện ngắn kinh điển viết về nạn đói năm 1945. Câu chuyện của Tràng và người vợ nhặt giữa thời khắc sinh tử đen tối.',
  },
  {
    title: 'Số đỏ',
    authorNames: ['Vũ Trọng Phụng'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Tiểu thuyết trào phúng bậc thầy của Vũ Trọng Phụng. Câu chuyện về Xuân Tóc Đỏ và xã hội thành thị Việt Nam những năm 1930.',
  },
  {
    title: 'Chí Phèo',
    authorNames: ['Nam Cao'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-viet-nam',
    desc: 'Truyện ngắn kinh điển của Nam Cao về bi kịch con người trong xã hội cũ. Tác phẩm nằm trong chương trình giảng dạy văn học Việt Nam.',
  },
  // Văn học nước ngoài
  {
    title: 'Nhà giả kim',
    authorNames: ['Paulo Coelho'],
    publisherName: 'NXB Hội Nhà Văn',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Hành trình của chàng chăn cừu Santiago đi tìm kho báu và chính mình. Một trong những cuốn sách bán chạy nhất mọi thời đại.',
  },
  {
    title: 'Trăm năm cô đơn',
    authorNames: ['Gabriel García Márquez'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Kiệt tác hiện thực huyền ảo của Gabriel García Márquez. Câu chuyện về bảy thế hệ gia đình Buendía tại thị trấn Macondo.',
  },
  {
    title: 'Bắt trẻ đồng xanh',
    authorNames: ['J.D. Salinger'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Hành trình của Holden Caulfield, một cậu bé tuổi teen lạc lõng ở New York. Tác phẩm gối đầu giường của giới trẻ toàn thế giới.',
  },
  {
    title: 'Giết con chim nhại',
    authorNames: ['Harper Lee'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Tiểu thuyết đoạt giải Pulitzer về nạn phân biệt chủng tộc ở miền Nam nước Mỹ. Câu chuyện được kể qua giọng của cô bé Scout.',
  },
  {
    title: 'Ông già và biển cả',
    authorNames: ['Ernest Hemingway'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Tác phẩm đem lại giải Nobel Văn học cho Ernest Hemingway. Câu chuyện về cuộc đấu tranh giữa lão ngư Santiago và một con cá kiếm khổng lồ.',
  },
  {
    title: 'Norwegian Wood',
    authorNames: ['Haruki Murakami'],
    publisherName: 'Nhã Nam',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Cuốn tiểu thuyết làm nên tên tuổi Haruki Murakami. Câu chuyện về tình yêu, mất mát và trưởng thành giữa nước Nhật thập niên 1960.',
  },
  {
    title: '1984',
    authorNames: ['George Orwell'],
    publisherName: 'NXB Hội Nhà Văn',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Tiểu thuyết phản địa đàng kinh điển của George Orwell. Bức tranh đáng sợ về một xã hội toàn trị nơi Big Brother luôn dõi theo bạn.',
  },
  {
    title: 'Đồi gió hú',
    authorNames: ['Emily Brontë'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'van-hoc-nuoc-ngoai',
    desc: 'Tiểu thuyết duy nhất của Emily Brontë và là một đỉnh cao của văn học Anh. Câu chuyện tình ám ảnh giữa Heathcliff và Catherine.',
  },
  // Kinh tế & Tài chính
  {
    title: 'Đắc nhân tâm',
    authorNames: ['Dale Carnegie'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'kinh-te-and-tai-chinh',
    desc: 'Cuốn sách kinh điển về nghệ thuật giao tiếp và ứng xử. Đã bán hơn 30 triệu bản trên toàn thế giới kể từ khi phát hành.',
  },
  {
    title: 'Người giàu có nhất thành Babylon',
    authorNames: ['George S. Clason'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'kinh-te-and-tai-chinh',
    desc: 'Những bài học tài chính vượt thời gian dưới dạng các câu chuyện ngụ ngôn Babylon cổ đại. Cẩm nang nhập môn về quản lý tiền bạc.',
  },
  {
    title: 'Cha giàu cha nghèo',
    authorNames: ['Robert Kiyosaki'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'kinh-te-and-tai-chinh',
    desc: 'Quyển sách làm thay đổi tư duy tài chính cho hàng triệu người. Robert Kiyosaki chia sẻ bài học từ hai người cha với hai cách nghĩ đối lập.',
  },
  {
    title: 'Tư duy nhanh và chậm',
    authorNames: ['Daniel Kahneman'],
    publisherName: 'NXB Thế Giới',
    categorySlug: 'kinh-te-and-tai-chinh',
    desc: 'Tác phẩm của nhà tâm lý học đoạt giải Nobel Daniel Kahneman. Khám phá hai hệ thống tư duy chi phối mọi quyết định của con người.',
  },
  {
    title: 'Khởi nghiệp tinh gọn',
    authorNames: ['Eric Ries'],
    publisherName: 'NXB Thời Đại',
    categorySlug: 'kinh-te-and-tai-chinh',
    desc: 'Cẩm nang khởi nghiệp thời đại mới của Eric Ries. Phương pháp Lean Startup đã được hàng triệu founder áp dụng trên toàn thế giới.',
  },
  // Kỹ năng sống
  {
    title: 'Đừng bao giờ đi ăn một mình',
    authorNames: ['Keith Ferrazzi'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'ky-nang-song',
    desc: 'Cẩm nang xây dựng mạng lưới quan hệ của Keith Ferrazzi. Bí quyết tạo dựng những mối quan hệ có ý nghĩa trong sự nghiệp và cuộc sống.',
  },
  {
    title: '7 thói quen hiệu quả',
    authorNames: ['Stephen Covey'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'ky-nang-song',
    desc: 'Cuốn sách self-help kinh điển của Stephen Covey đã bán hơn 40 triệu bản. Bảy thói quen giúp chuyển hóa tư duy và cuộc sống cá nhân.',
  },
  {
    title: 'Tuổi trẻ đáng giá bao nhiêu',
    authorNames: ['Rosie Nguyễn'],
    publisherName: 'NXB Hội Nhà Văn',
    categorySlug: 'ky-nang-song',
    desc: 'Cuốn sách truyền cảm hứng cho người trẻ Việt Nam của tác giả Rosie Nguyễn. Những câu chuyện thật về học, làm và trải nghiệm.',
  },
  {
    title: 'Mình nói gì khi nói về hạnh phúc',
    authorNames: ['Phan Việt'],
    publisherName: 'Nhã Nam',
    categorySlug: 'ky-nang-song',
    desc: 'Tác phẩm chiêm nghiệm sâu sắc của Phan Việt. Những suy tư giản dị mà ấm áp về hạnh phúc, về sống đủ và sống tử tế.',
  },
  {
    title: 'Muôn kiếp nhân sinh',
    authorNames: ['Nguyên Phong'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'ky-nang-song',
    desc: 'Bộ sách bán chạy nhất của Nguyên Phong về luân hồi và nhân quả. Hành trình khám phá ý nghĩa thực sự của kiếp người.',
  },
  // Thiếu nhi
  {
    title: 'Doraemon tập 1',
    authorNames: ['Fujiko F. Fujio'],
    publisherName: 'NXB Kim Đồng',
    categorySlug: 'thieu-nhi',
    desc: 'Tập đầu tiên của bộ truyện tranh Doraemon huyền thoại. Những chuyến phiêu lưu vui nhộn của Nobita và chú mèo máy đến từ tương lai.',
  },
  {
    title: 'Thần đồng đất Việt',
    authorNames: ['Lê Linh'],
    publisherName: 'Phan Thị',
    categorySlug: 'thieu-nhi',
    desc: 'Bộ truyện tranh lịch sử Việt Nam được yêu thích nhất. Trạng Tí và các bạn trong những câu chuyện vừa vui vừa dạy kiến thức.',
  },
  {
    title: 'Hoàng tử bé',
    authorNames: ['Antoine de Saint-Exupéry'],
    publisherName: 'NXB Kim Đồng',
    categorySlug: 'thieu-nhi',
    desc: 'Kiệt tác văn học dành cho mọi lứa tuổi của Saint-Exupéry. Hành trình của Hoàng Tử Bé qua các tiểu hành tinh là bài học về tình yêu và cuộc sống.',
  },
  {
    title: 'Totto-chan bên cửa sổ',
    authorNames: ['Tetsuko Kuroyanagi'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'thieu-nhi',
    desc: 'Câu chuyện tự truyện của Tetsuko Kuroyanagi về ngôi trường Tomoe đặc biệt. Tác phẩm giáo dục gối đầu giường của mọi phụ huynh.',
  },
  // Truyện tranh
  {
    title: 'One Piece tập 1',
    authorNames: ['Eiichiro Oda'],
    publisherName: 'NXB Kim Đồng',
    categorySlug: 'truyen-tranh',
    desc: 'Tập đầu của bộ manga bán chạy nhất lịch sử của Eiichiro Oda. Hành trình của Luffy và đồng đội truy tìm kho báu One Piece.',
  },
  {
    title: 'Naruto tập 1',
    authorNames: ['Masashi Kishimoto'],
    publisherName: 'NXB Kim Đồng',
    categorySlug: 'truyen-tranh',
    desc: 'Tập mở đầu của huyền thoại manga Naruto. Hành trình trở thành Hokage của cậu nhóc ninja Uzumaki Naruto ở làng Lá.',
  },
  {
    title: 'Conan tập 1',
    authorNames: ['Gosho Aoyama'],
    publisherName: 'NXB Kim Đồng',
    categorySlug: 'truyen-tranh',
    desc: 'Tập đầu tiên của bộ truyện thám tử Conan huyền thoại. Shinichi Kudo bị biến thành cậu nhóc và các vụ án ly kỳ bắt đầu.',
  },
  // Lịch sử & Văn hoá
  {
    title: 'Việt Nam sử lược',
    authorNames: ['Trần Trọng Kim'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'lich-su-and-van-hoa',
    desc: 'Cuốn thông sử Việt Nam đầu tiên bằng chữ quốc ngữ của Trần Trọng Kim. Một tài liệu tham khảo kinh điển cho người yêu sử Việt.',
  },
  {
    title: 'Đại Việt sử ký toàn thư',
    authorNames: ['Ngô Sĩ Liên'],
    publisherName: 'NXB Khoa Học Xã Hội',
    categorySlug: 'lich-su-and-van-hoa',
    desc: 'Bộ quốc sử kinh điển của Đại Việt do Ngô Sĩ Liên biên soạn. Nguồn sử liệu quý giá bậc nhất của lịch sử Việt Nam thời trung đại.',
  },
  {
    title: 'Lịch sử văn minh thế giới',
    authorNames: ['Will Durant'],
    publisherName: 'NXB Văn Học',
    categorySlug: 'lich-su-and-van-hoa',
    desc: 'Bộ sách đồ sộ của Will Durant về lịch sử và văn minh nhân loại. Một hành trình hấp dẫn qua các nền văn minh rực rỡ trong lịch sử.',
  },
  // Tâm lý học
  {
    title: 'Quiet - Sức mạnh người hướng nội',
    authorNames: ['Susan Cain'],
    publisherName: 'Nhã Nam',
    categorySlug: 'tam-ly-hoc',
    desc: 'Tác phẩm đổi mới tư duy về người hướng nội của Susan Cain. Khám phá những thế mạnh mà thế giới ồn ào thường bỏ quên.',
  },
  {
    title: 'Dám bị ghét',
    authorNames: ['Ichiro Kishimi'],
    publisherName: 'Nhã Nam',
    categorySlug: 'tam-ly-hoc',
    desc: 'Bestseller Nhật Bản về tâm lý học Adler của Ichiro Kishimi. Cuộc đối thoại giữa triết gia và chàng trai trẻ về ý nghĩa tự do cá nhân.',
  },
  // Thiết kế & Sáng tạo
  {
    title: 'Nghệ thuật tư duy rành mạch',
    authorNames: ['Rolf Dobelli'],
    publisherName: 'First News - Trí Việt',
    categorySlug: 'thiet-ke-and-sang-tao',
    desc: '99 lỗi nhận thức phổ biến nhất mà não người thường mắc phải, được Rolf Dobelli trình bày rõ ràng. Công cụ quý để rèn tư duy phản biện.',
  },
  // Khoa học
  {
    title: 'Sapiens - Lược sử loài người',
    authorNames: ['Yuval Noah Harari'],
    publisherName: 'NXB Thế Giới',
    categorySlug: 'khoa-hoc',
    desc: 'Cuốn sách hiện tượng toàn cầu của Yuval Noah Harari. Hành trình 70.000 năm của loài người từ thảo nguyên châu Phi đến kỷ nguyên số.',
  },
  {
    title: 'Lược sử thời gian',
    authorNames: ['Stephen Hawking'],
    publisherName: 'NXB Trẻ',
    categorySlug: 'khoa-hoc',
    desc: 'Tác phẩm phổ biến khoa học kinh điển của Stephen Hawking. Hành trình từ Big Bang tới hố đen được kể lại bằng ngôn ngữ dễ hiểu.',
  },
];

const AUTHORS: Array<{ name: string; nationality: string }> = [
  { name: 'Nguyễn Nhật Ánh', nationality: 'Việt Nam' },
  { name: 'Tô Hoài', nationality: 'Việt Nam' },
  { name: 'Kim Lân', nationality: 'Việt Nam' },
  { name: 'Nam Cao', nationality: 'Việt Nam' },
  { name: 'Vũ Trọng Phụng', nationality: 'Việt Nam' },
  { name: 'Paulo Coelho', nationality: 'Brazil' },
  { name: 'Gabriel García Márquez', nationality: 'Colombia' },
  { name: 'Haruki Murakami', nationality: 'Nhật Bản' },
  { name: 'George Orwell', nationality: 'Anh' },
  { name: 'Dale Carnegie', nationality: 'Mỹ' },
  { name: 'Robert Kiyosaki', nationality: 'Mỹ' },
  { name: 'Daniel Kahneman', nationality: 'Mỹ' },
  { name: 'Stephen Covey', nationality: 'Mỹ' },
  { name: 'Keith Ferrazzi', nationality: 'Mỹ' },
  { name: 'Rosie Nguyễn', nationality: 'Việt Nam' },
  { name: 'Nguyên Phong', nationality: 'Việt Nam' },
  { name: 'Antoine de Saint-Exupéry', nationality: 'Pháp' },
  { name: 'Fujiko F. Fujio', nationality: 'Nhật Bản' },
  { name: 'Eiichiro Oda', nationality: 'Nhật Bản' },
  { name: 'Trần Trọng Kim', nationality: 'Việt Nam' },
  { name: 'Susan Cain', nationality: 'Mỹ' },
  { name: 'Ichiro Kishimi', nationality: 'Nhật Bản' },
  { name: 'Yuval Noah Harari', nationality: 'Israel' },
  { name: 'Stephen Hawking', nationality: 'Anh' },
  { name: 'Will Durant', nationality: 'Mỹ' },
  { name: 'Ernest Hemingway', nationality: 'Mỹ' },
  { name: 'J.D. Salinger', nationality: 'Mỹ' },
  { name: 'Harper Lee', nationality: 'Mỹ' },
  { name: 'Emily Brontë', nationality: 'Anh' },
  { name: 'Eric Ries', nationality: 'Mỹ' },
  { name: 'Rolf Dobelli', nationality: 'Thụy Sĩ' },
  { name: 'Lê Linh', nationality: 'Việt Nam' },
  { name: 'Masashi Kishimoto', nationality: 'Nhật Bản' },
  { name: 'Gosho Aoyama', nationality: 'Nhật Bản' },
  { name: 'Ngô Sĩ Liên', nationality: 'Việt Nam' },
  { name: 'Tetsuko Kuroyanagi', nationality: 'Nhật Bản' },
  { name: 'Phan Việt', nationality: 'Việt Nam' },
  { name: 'George S. Clason', nationality: 'Mỹ' },
];

const PUBLISHERS: string[] = [
  'NXB Trẻ',
  'NXB Kim Đồng',
  'NXB Văn Học',
  'NXB Hội Nhà Văn',
  'First News - Trí Việt',
  'Nhã Nam',
  'NXB Thế Giới',
  'NXB Thời Đại',
  'Phan Thị',
  'NXB Khoa Học Xã Hội',
];

function buildIsbn(slug: string): string {
  // 978 + 10 deterministic digits derived from slug hash
  const h = hashString(slug).toString().padStart(10, '0').slice(-10);
  return `978${h}`;
}

async function wipeReseedTargets(): Promise<void> {
  const ds = dataSource;
  // Clear dependent rows first (book_authors, book_images, stock_logs scoped to INITIAL_IMPORT, price_history)
  await ds.query(`DELETE FROM book_authors`);
  await ds.query(`DELETE FROM book_images`);
  await ds.query(`DELETE FROM stock_logs WHERE reason = 'INITIAL_IMPORT'`);
  await ds.query(`DELETE FROM price_history`);
  // Cart items & wishlist reference books; clear those too so books can be wiped cleanly
  await ds.query(`DELETE FROM cart_items`);
  await ds.query(`DELETE FROM wishlists`);
  // order_items has ON DELETE RESTRICT from books -> clear orders first for a full reseed
  await ds.query(`DELETE FROM order_items`);
  await ds.query(`DELETE FROM order_status_logs`);
  await ds.query(`DELETE FROM payments`);
  await ds.query(`DELETE FROM voucher_usages`);
  await ds.query(`DELETE FROM refund_requests`);
  await ds.query(`DELETE FROM orders`);
  // Reviews & review images too (FK to books)
  await ds.query(`DELETE FROM review_images`);
  await ds.query(`DELETE FROM reviews`);
  // All remaining stock logs (including non-INITIAL_IMPORT) would block book deletion via book_id FK
  await ds.query(`DELETE FROM stock_logs`);
  await ds.query(`DELETE FROM books`);
}

async function run() {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  const RESEED = String(process.env.RESEED || '').toLowerCase() === 'true';

  if (RESEED) {
    // eslint-disable-next-line no-console
    console.log('RESEED=true -> wiping books / book_authors / book_images / stock_logs(initial_import) / price_history ...');
    await wipeReseedTargets();
  }

  // Clean up broken uploads (fake PNG etc.)
  const removedCount = cleanupBrokenUploads();
  if (removedCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`Removed ${removedCount} broken upload file(s).`);
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // 1. Users — keep admin/staff/3 customers for token continuity
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

  // 2. Authors (pool)
  const authorByName = new Map<string, Author>();
  for (const a of AUTHORS) {
    const ent = await upsertAuthor(a.name, a.nationality);
    authorByName.set(a.name, ent);
  }

  // 3. Publishers (pool)
  const pubByName = new Map<string, Publisher>();
  for (const p of PUBLISHERS) {
    const ent = await upsertPublisher(p);
    pubByName.set(p, ent);
  }

  // 4. Categories (full tree)
  const catBySlug = new Map<string, Category>();

  const vanHoc = await upsertCategory('Văn học', null, 1);
  catBySlug.set(vanHoc.slug, vanHoc);
  const vhvn = await upsertCategory('Văn học Việt Nam', vanHoc.id, 2);
  catBySlug.set(vhvn.slug, vhvn);
  const vhnn = await upsertCategory('Văn học nước ngoài', vanHoc.id, 3);
  catBySlug.set(vhnn.slug, vhnn);

  const kinhTe = await upsertCategory('Kinh tế & Tài chính', null, 4);
  catBySlug.set(kinhTe.slug, kinhTe);

  const kyNangSong = await upsertCategory('Kỹ năng sống', null, 5);
  catBySlug.set(kyNangSong.slug, kyNangSong);
  const phatTrienBanThan = await upsertCategory(
    'Phát triển bản thân',
    kyNangSong.id,
    6,
  );
  catBySlug.set(phatTrienBanThan.slug, phatTrienBanThan);

  const thieuNhi = await upsertCategory('Thiếu nhi', null, 7);
  catBySlug.set(thieuNhi.slug, thieuNhi);
  const truyenTranh = await upsertCategory('Truyện tranh', thieuNhi.id, 8);
  catBySlug.set(truyenTranh.slug, truyenTranh);

  const lichSu = await upsertCategory('Lịch sử & Văn hoá', null, 9);
  catBySlug.set(lichSu.slug, lichSu);

  const tamLyHoc = await upsertCategory('Tâm lý học', null, 10);
  catBySlug.set(tamLyHoc.slug, tamLyHoc);

  const thietKe = await upsertCategory('Thiết kế & Sáng tạo', null, 11);
  catBySlug.set(thietKe.slug, thietKe);

  const khoaHoc = await upsertCategory('Khoa học', null, 12);
  catBySlug.set(khoaHoc.slug, khoaHoc);

  // 5. Books
  const bookRepo = dataSource.getRepository(Book);
  const bookAuthorRepo = dataSource.getRepository(BookAuthor);
  const bookImageRepo = dataSource.getRepository(BookImage);
  const stockLogRepo = dataSource.getRepository(StockLog);

  const seenIsbn = new Set<string>();
  let svgsWritten = 0;
  let booksInserted = 0;
  let booksSkipped = 0;

  for (let i = 0; i < BOOK_SEED.length; i++) {
    const b = BOOK_SEED[i];
    const slug = toSlug(b.title);
    const rand = seededRand(slug);

    let isbn = buildIsbn(slug);
    // Collision guard (extremely unlikely) — mutate last digit until unique.
    while (seenIsbn.has(isbn)) {
      const last = Number(isbn.slice(-1));
      isbn = isbn.slice(0, -1) + String((last + 1) % 10);
    }
    seenIsbn.add(isbn);

    // Skip if existing (by slug or isbn)
    const existingBySlug = await bookRepo.findOne({ where: { slug } });
    const existingByIsbn = existingBySlug
      ? null
      : await bookRepo.findOne({ where: { isbn } });
    if (existingBySlug || existingByIsbn) {
      // eslint-disable-next-line no-console
      console.log(`skip: ${slug}`);
      booksSkipped += 1;
      continue;
    }

    const cat = catBySlug.get(b.categorySlug);
    if (!cat) throw new Error(`Missing category ${b.categorySlug} for ${b.title}`);
    const pub = pubByName.get(b.publisherName);
    if (!pub) throw new Error(`Missing publisher ${b.publisherName}`);

    // Attributes
    const price = pickInt(rand, 55, 450) * 1000; // VND
    const hasDiscount = rand() < 0.3;
    let discountPrice: string | null = null;
    let discountEndDate: Date | null = null;
    if (hasDiscount) {
      const pct = pickInt(rand, 10, 30);
      const dp = Math.round((price * (100 - pct)) / 100 / 1000) * 1000;
      discountPrice = dp.toFixed(2);
      discountEndDate = new Date();
      discountEndDate.setDate(discountEndDate.getDate() + 30);
    }
    const stock = pickInt(rand, 15, 200);
    const pages = pickInt(rand, 120, 700);
    const dims = rand() < 0.5 ? '13x20 cm' : '14.5x20.5 cm';
    const weight = (pickInt(rand, 150, 800) / 1000).toFixed(2); // kg, column allows 6,2
    const yearPublished = pickInt(rand, 1995, 2024);
    const avgRating = (Math.floor(rand() * 1500) / 1000 + 3.5).toFixed(2); // 3.50 - 5.00
    const reviewCount = pickInt(rand, 20, 900);

    // Generate cover SVG
    const primaryAuthorName = b.authorNames[0];
    const svgPath = path.join(UPLOADS_DIR, `${slug}.svg`);
    fs.writeFileSync(svgPath, buildCoverSvg(b.title, primaryAuthorName), 'utf8');
    svgsWritten += 1;

    // Insert book
    const book = bookRepo.create({
      title: b.title,
      slug,
      isbn,
      publisherId: pub.id,
      categoryId: cat.id,
      language: 'Tiếng Việt',
      yearPublished,
      price: price.toFixed(2),
      discountPrice,
      discountEndDate,
      description: b.desc,
      pages,
      dimensions: dims,
      weight,
      stockQuantity: stock,
      status: BookStatus.ACTIVE,
      avgRating,
      reviewCount,
    });
    const saved = await bookRepo.save(book);

    // Authors link
    for (const an of b.authorNames) {
      const a = authorByName.get(an);
      if (!a) throw new Error(`Missing author ${an} for ${b.title}`);
      await bookAuthorRepo.save(
        bookAuthorRepo.create({ bookId: saved.id, authorId: a.id }),
      );
    }

    // Primary image (local SVG)
    await bookImageRepo.save(
      bookImageRepo.create({
        bookId: saved.id,
        imageUrl: `/uploads/books/${slug}.svg`,
        isPrimary: true,
        displayOrder: 0,
      }),
    );

    // Stock log
    await stockLogRepo.save(
      stockLogRepo.create({
        bookId: saved.id,
        changeAmount: stock,
        newQuantity: stock,
        reason: StockReason.INITIAL_IMPORT,
        orderId: null,
        createdBy: admin.id,
        note: 'Nhập kho ban đầu',
      }),
    );

    booksInserted += 1;
  }

  const authorsCount = await dataSource.getRepository(Author).count();
  const publishersCount = await dataSource.getRepository(Publisher).count();
  const categoriesCount = await dataSource.getRepository(Category).count();
  const booksCount = await dataSource.getRepository(Book).count();

  // eslint-disable-next-line no-console
  console.log(
    `\nSeed summary: ${authorsCount} authors / ${publishersCount} publishers / ${categoriesCount} categories / ${booksCount} books / ${svgsWritten} cover svgs generated (inserted ${booksInserted}, skipped ${booksSkipped}).\n` +
      `Accounts: admin=${admin.email}, staff=${staff.email}, customers=${customers.length}`,
  );

  // Touch priceHistoriesRepo so typescript unused import warnings don't pop — we only imported for wipe clarity.
  void PriceHistory;

  await dataSource.destroy();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
