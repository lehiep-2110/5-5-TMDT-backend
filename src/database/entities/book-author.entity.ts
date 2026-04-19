import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Book } from './book.entity';
import { Author } from './author.entity';

@Entity({ name: 'book_authors' })
export class BookAuthor {
  @PrimaryColumn({ name: 'book_id', type: 'uuid' })
  bookId!: string;

  @PrimaryColumn({ name: 'author_id', type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => Book, (b) => b.bookAuthors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book?: Book;

  @ManyToOne(() => Author, (a) => a.bookAuthors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author?: Author;
}
