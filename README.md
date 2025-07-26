## Features

### Authentication
- User registration and login
- JWT-based authentication with access and refresh tokens
- Protected routes and API endpoints

### File Management
- Upload multiple files to AWS S3
- Organize files in folders
- View all uploaded files with metadata
- Download files via signed URLs
- Delete files (removes from both S3 and database)
- Filter files by folder and file type

### Security
- All file operations are protected by JWT authentication
- Files are uploaded to AWS S3 through the backend (not directly from frontend)
- File metadata stored securely in MongoDB

### Backend
- **Node.js** with **Express.js** (TypeScript)
- **JWT** for authentication
- **MongoDB** with Mongoose for database
- **AWS S3** for file storage
- **Multer** for file uploads


#### Install Dependencies

cd server
npm install

npm run dev