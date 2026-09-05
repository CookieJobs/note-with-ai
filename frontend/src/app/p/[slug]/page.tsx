import type { Metadata } from 'next';
import PublicSnapshot from './PublicSnapshot';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicNotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSnapshot slug={slug} />;
}

