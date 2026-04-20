import { IsEnum } from 'class-validator';
import { ReviewStatus } from '../../../common/enums/review-status.enum';

export class UpdateReviewStatusDto {
  @IsEnum(ReviewStatus, { message: 'Trạng thái đánh giá không hợp lệ.' })
  status!: ReviewStatus;
}
