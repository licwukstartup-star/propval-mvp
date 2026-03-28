import type { Metadata } from "next";
import { Inter, Orbitron, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import ThemeProvider from "@/components/ThemeProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import Navbar from "@/components/Navbar";
import CookieConsent from "@/components/CookieConsent";
import AppShell from "@/components/AppShell";
import { SidebarProvider } from "@/contexts/SidebarContext";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-orbitron",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PropVal",
  description: "Property intelligence platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="premium-dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("propval-theme");if(t==="light"||t==="dark"||t==="premium-dark"||t==="premium-light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${orbitron.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          <AuthProvider>
            <SidebarProvider>
              <Navbar />
              <ErrorBoundary>
                <AppShell>
                  {children}
                </AppShell>
              </ErrorBoundary>
            </SidebarProvider>
            <CookieConsent />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
