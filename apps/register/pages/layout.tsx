import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <head>
                <title>Register</title>
                <meta name="description" content="Event Registration" />
            </head>
            <body className={inter.className}>{children}</body>
        </html>
    )
}
