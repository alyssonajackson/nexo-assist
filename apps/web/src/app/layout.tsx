import type { Metadata } from 'next'
import { Newsreader, Schibsted_Grotesk } from 'next/font/google'
import './globals.css'

const sans = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-schibsted' })
const serif = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', weight: ['400'] })

export const metadata: Metadata = {
  title: 'Nexo Assist',
  description: 'Service desk de TI da Nexo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
