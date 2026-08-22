'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, X, Upload } from 'lucide-react'
import { api } from '@/lib/api'

export default function UploadPage() {
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const queryClient = useQueryClient()

  const handleFile = (f: File) => {
    if (!f.type.startsWith('image/')) {
      toast.error('Sadece görsel dosyası yükleyebilirsin')
      return
    }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (caption) formData.append('caption', caption)

      await api.post('/posts', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      toast.success('Fotoğraf paylaşıldı! Puanlar hesaplanıyor.')
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      router.push('/feed')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Yükleme başarısız oldu'
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="pt-6 pb-24 max-w-lg mx-auto">
      <h1 className="text-white text-xl font-bold mb-6">Fotoğraf Paylaş</h1>

      <div
        onClick={() => !preview && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`relative aspect-square w-full rounded-2xl border-2 border-dashed overflow-hidden mb-4 transition-colors
          ${preview ? 'border-transparent cursor-default' : 'border-white/20 hover:border-brand-500 cursor-pointer'}`}
      >
        {preview ? (
          <>
            <Image src={preview} alt="preview" fill className="object-cover" />
            <button
              onClick={() => { setPreview(null); setFile(null) }}
              className="absolute top-3 right-3 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 bg-white/[0.03]">
            <Camera className="w-12 h-12 text-gray-500" />
            <p className="text-gray-400 text-sm">Tıkla veya sürükle bırak</p>
            <p className="text-gray-600 text-xs">JPG, PNG, WEBP</p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />

      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Açıklama ekle..."
        maxLength={200}
        rows={3}
        className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-brand-500 transition-colors resize-none mb-4"
      />

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="w-full py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        <Upload className="w-4 h-4" />
        {uploading ? 'Yükleniyor...' : 'Paylaş'}
      </button>
    </div>
  )
}
