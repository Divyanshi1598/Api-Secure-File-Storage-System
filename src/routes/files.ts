import express, { Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import File from '../models/File';
import { authenticate, AuthRequest } from '../middleware/auth';
import { s3, S3_BUCKET, validateAWSConfig } from '../config/aws';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 10 // Maximum 10 files at once
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types but check for potential security risks
    const allowedMimes = [
      'image/', 'video/', 'audio/', 'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument', 'text/', 'application/zip',
      'application/x-rar-compressed', 'application/json', 'application/xml'
    ];
    
    const isAllowed = allowedMimes.some(mime => file.mimetype.startsWith(mime));
    
    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Helper function to determine file type
const getFileType = (mimetype: string): string => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.includes('pdf') || mimetype.includes('document') || mimetype.includes('text')) return 'document';
  if (mimetype.includes('zip') || mimetype.includes('rar') || mimetype.includes('tar')) return 'archive';
  return 'other';
};

// Helper function to generate S3 key with username as folder
const generateS3Key = (username: string, folder: string, filename: string): string => {
  const sanitizedFolder = folder.replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
  const folderPath = sanitizedFolder ? `${sanitizedFolder}/` : '';
  return `users/${username}/${folderPath}${filename}`;
};

// Upload files endpoint
router.post('/upload', authenticate, upload.array('files', 10), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    // Validate AWS configuration
    if (!validateAWSConfig()) {
      res.status(500).json({ message: 'AWS S3 configuration is incomplete' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    const folder = (req.body.folder as string) || '/';

    if (!files || files.length === 0) {
      res.status(400).json({ message: 'No files uploaded' });
      return;
    }

    const uploadedFiles = [];

    for (const file of files) {
      try {
        // Generate unique filename
        const fileExtension = file.originalname.split('.').pop() || '';
        const uniqueFilename = `${uuidv4()}.${fileExtension}`;
        // Use username as the S3 folder prefix
        const username = req.user.username || req.user.email || req.user.id;
        const s3Key = generateS3Key(username, folder, uniqueFilename);

        // Upload to S3
        const uploadParams = {
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'private' as const,
          Metadata: {
            userId: req.user.id,
            // user metadata can include username or email change
            username: username,
            originalName: file.originalname,
            uploadTime: new Date().toISOString()
          }
        };

        const uploadResult = await s3.upload(uploadParams).promise();

        // Save file metadata to database
        const newFile = new File({
          filename: uniqueFilename,
          originalName: file.originalname,
          size: file.size,
          url: uploadResult.Location,
          s3Key: s3Key,
          contentType: file.mimetype,
          fileType: getFileType(file.mimetype),
          folder: folder,
          userId: req.user.id
        });

        await newFile.save();

        uploadedFiles.push({
          id: newFile._id,
          filename: newFile.filename,
          originalName: newFile.originalName,
          size: newFile.size,
          contentType: newFile.contentType,
          fileType: newFile.fileType,
          folder: newFile.folder,
          uploadTime: newFile.uploadTime
        });

      } catch (fileError) {
        console.error(`Error uploading file ${file.originalname}:`, fileError);
        // Continue with other files, but log the error
      }
    }

    if (uploadedFiles.length === 0) {
      res.status(500).json({ message: 'Failed to upload any files' });
      return;
    }

    res.status(201).json({
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      files: uploadedFiles
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Server error during file upload',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// Get user's files endpoint
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    const { folder, fileType, page = '1', limit = '20' } = req.query;
    
    // Build query
    const query: any = { userId: req.user.id };
    
    // Only add filters if they're non-empty strings
    if (folder && typeof folder === 'string' && folder.trim() !== '') {
      query.folder = folder;
    }
    
    if (fileType && typeof fileType === 'string' && fileType.trim() !== '') {
      query.fileType = fileType;
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Get files with pagination
    const files = await File.find(query)
      .select('-s3Key') // Don't expose S3 key to frontend
      .sort({ uploadTime: -1 })
      .skip(skip)
      .limit(limitNum);

    const totalFiles = await File.countDocuments(query);
    const totalPages = Math.ceil(totalFiles / limitNum);

    res.json({
      files: Array.isArray(files) ? files : [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalFiles,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });

  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ 
      message: 'Server error while fetching files',
      files: [] // Always return an empty array in case of error
    });
  }
});

// Get download link endpoint
router.get('/:id/download', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    const file = await File.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!file) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    // Generate signed URL for download (valid for 1 hour)
    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: S3_BUCKET,
      Key: file.s3Key,
      Expires: 3600, // 1 hour
      ResponseContentDisposition: `attachment; filename="${file.originalName}"`
    });

    res.json({ 
      url: signedUrl, // Using 'url' to match what the frontend expects
      downloadUrl: signedUrl, // Keep for backward compatibility
      signedUrl: signedUrl, // Another common name
      filename: file.originalName,
      expiresIn: 3600
    });

  } catch (error) {
    console.error('Download link error:', error);
    res.status(500).json({ message: 'Server error while generating download link' });
  }
});

// Delete file endpoint
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    const file = await File.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!file) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    // Delete from S3
    try {
      await s3.deleteObject({
        Bucket: S3_BUCKET,
        Key: file.s3Key
      }).promise();
    } catch (s3Error) {
      console.error('S3 deletion error:', s3Error);
      // Continue with database deletion even if S3 deletion fails
    }

    // Delete from database
    await File.findByIdAndDelete(file._id);

    res.json({ 
      message: 'File deleted successfully',
      filename: file.originalName
    });

  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Server error while deleting file' });
  }
});

// Get file info endpoint
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    const file = await File.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    }).select('-s3Key');

    if (!file) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    res.json({ file });

  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({ message: 'Server error while fetching file info' });
  }
});

// Get folders endpoint
router.get('/folders/list', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    const folders = await File.distinct('folder', { userId: req.user.id });
    
    res.json({ folders: folders.sort() });

  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ message: 'Server error while fetching folders' });
  }
});

export default router;
