import Image from "next/image";

export function Logo({ height = 28 }: { height?: number }) {
  // Source image is 1484x260.
  const width = Math.round((height * 1484) / 260);
  return <Image src="/syndicatelend-logo.png" alt="SyndicateLend" width={width} height={height} priority />;
}
