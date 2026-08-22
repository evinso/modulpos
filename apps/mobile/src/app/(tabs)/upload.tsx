import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Camera, X } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'

export default function UploadScreen() {
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    })
    if (!result.canceled && result.assets[0]) {
      setImage(result.assets[0])
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  const handleUpload = async () => {
    if (!image) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', {
        uri: image.uri,
        type: image.mimeType ?? 'image/jpeg',
        name: 'photo.jpg',
      } as unknown as Blob)
      if (caption) formData.append('caption', caption)

      await api.post('/posts', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      Alert.alert('Başarılı!', 'Fotoğrafın paylaşıldı, puanlar hesaplanıyor.', [
        { text: 'Tamam', onPress: () => router.replace('/(tabs)') },
      ])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Yükleme başarısız oldu'
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Hata', msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-white text-xl font-bold mt-4 mb-6">Fotoğraf Paylaş</Text>

        <TouchableOpacity
          onPress={pickImage}
          className="aspect-square w-full bg-white/5 border border-white/10 rounded-2xl items-center justify-center overflow-hidden mb-4"
          activeOpacity={0.8}
        >
          {image ? (
            <>
              <Image source={{ uri: image.uri }} className="w-full h-full" resizeMode="cover" />
              <TouchableOpacity
                onPress={() => setImage(null)}
                className="absolute top-3 right-3 w-8 h-8 bg-black/60 rounded-full items-center justify-center"
              >
                <X size={16} color="white" />
              </TouchableOpacity>
            </>
          ) : (
            <View className="items-center gap-3">
              <Camera size={40} color="#71717a" />
              <Text className="text-zinc-500 text-sm">Galeriden seç</Text>
            </View>
          )}
        </TouchableOpacity>

        <TextInput
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white mb-6"
          placeholder="Açıklama ekle..."
          placeholderTextColor="#71717a"
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={200}
        />

        <TouchableOpacity
          onPress={handleUpload}
          disabled={!image || uploading}
          className={`py-4 rounded-xl items-center ${image && !uploading ? 'bg-brand-600' : 'bg-zinc-800'}`}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className={`font-semibold text-base ${image ? 'text-white' : 'text-zinc-500'}`}>
              Paylaş
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}
