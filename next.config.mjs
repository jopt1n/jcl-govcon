/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    dirs: ["src/app", "src/components", "src/lib"],
  },
  async redirects() {
    return [
      {
        source: "/chosen",
        destination: "/pursuits",
        permanent: false,
      },
      {
        source: "/chosen/",
        destination: "/pursuits",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
