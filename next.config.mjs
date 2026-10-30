/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // a página do profissional virou a "/"; 301 para não quebrar links já divulgados
      { source: "/profissional", destination: "/", statusCode: 301 },
    ];
  },
};

export default nextConfig;
