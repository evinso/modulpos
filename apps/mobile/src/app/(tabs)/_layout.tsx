import { Tabs } from 'expo-router'
import { Home, Trophy, PlusSquare, User, Coins } from 'lucide-react-native'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#09090b',
          borderTopColor: 'rgba(255,255,255,0.06)',
          height: 64,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: '#d946ef',
        tabBarInactiveTintColor: '#71717a',
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana Sayfa',
          tabBarIcon: ({ color }) => <Home size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="challenges"
        options={{
          title: 'Challenge',
          tabBarIcon: ({ color }) => <Trophy size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upload"
        options={{
          title: 'Paylaş',
          tabBarIcon: ({ color }) => <PlusSquare size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="points"
        options={{
          title: 'Puanlar',
          tabBarIcon: ({ color }) => <Coins size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }) => <User size={24} color={color} />,
        }}
      />
    </Tabs>
  )
}
