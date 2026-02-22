export default async function handler(req, res) {
  try {
    const response = await fetch('https://metaforge.app/api/arc-raiders/events-schedule');
    const data = await response.json();
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
