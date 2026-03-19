export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    message: "GDG Vercel API is working",
    time: new Date().toISOString()
  });
}
