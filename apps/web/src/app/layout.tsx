import "@/styles/globals.css";

export const metadata = {
  title: "Abhyash-India",
  description: "Speak with confidence. Multilingual voice practice for India.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-hero-gradient font-body text-ink">
        {children}
      </body>
    </html>
  );
}
