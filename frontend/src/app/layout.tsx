import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TitleNode | The Intelligence Layer for Land',
  description: 'Enterprise Land Intelligence & Title Search Platform for Advocates and Developers',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#07152B] text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}