import mongoose, { Document, Schema } from 'mongoose';

export interface IFile extends Document {
  filename: string;
  originalName: string;
  size: number;
  url: string;
  s3Key: string;
  contentType: string;
  fileType: string;
  folder: string;
  userId: mongoose.Types.ObjectId;
  uploadTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IFile>({
  filename: {
    type: String,
    required: [true, 'Filename is required'],
    trim: true
  },
  originalName: {
    type: String,
    required: [true, 'Original filename is required'],
    trim: true
  },
  size: {
    type: Number,
    required: [true, 'File size is required'],
    min: [0, 'File size cannot be negative']
  },
  url: {
    type: String,
    required: [true, 'File URL is required']
  },
  s3Key: {
    type: String,
    required: [true, 'S3 key is required'],
    unique: true
  },
  contentType: {
    type: String,
    required: [true, 'Content type is required']
  },
  fileType: {
    type: String,
    required: [true, 'File type is required'],
    enum: ['image', 'document', 'video', 'audio', 'archive', 'other']
  },
  folder: {
    type: String,
    default: '/',
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  uploadTime: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
fileSchema.index({ userId: 1, folder: 1 });
fileSchema.index({ userId: 1, fileType: 1 });

export default mongoose.model<IFile>('File', fileSchema);
