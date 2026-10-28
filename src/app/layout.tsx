import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spec Rabbit',
  description: 'Visual orchestrator for Spec-Driven Development (SDD)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
