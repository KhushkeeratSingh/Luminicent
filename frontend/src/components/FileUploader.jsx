import { useState, useRef } from 'react'
import './FileUploader.css'

export default function FileUploader({ socket, onUploadStart, onUploadComplete }) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef(null)

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      uploadFile(files[0])
    }
  }

  const handleFileSelect = (e) => {
    const files = e.target.files
    if (files.length > 0) {
      uploadFile(files[0])
      e.target.value = ''
    }
  }

  const uploadFile = async (file) => {
    if (!file.name.endsWith('.zip')) {
      alert('Please upload a .zip file')
      return
    }

    setIsUploading(true)
    const sessionId = onUploadStart()

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (sessionId) {
        formData.append('sessionId', sessionId)
      }

      const response = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData
      })

      const data = await response.json()
      if (response.ok) {
        onUploadComplete(data.sessionId)
      } else {
        alert('Upload failed: ' + data.error)
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('Upload error: ' + error.message)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="file-uploader">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="drop-zone-content">
          <div className="upload-icon">📦</div>
          <h3>Drag & Drop your .zip file</h3>
          <p>or click to select</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={handleFileSelect}
            disabled={isUploading}
            className="hidden-input"
          />
        </div>
      </div>

      {isUploading && (
        <div className="uploading">
          <div className="spinner"></div>
          <p>Uploading and processing...</p>
        </div>
      )}
    </div>
  )
}
