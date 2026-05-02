// api/detail.js - 施設詳細 + クチコミ + AI設備解析

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ytsurusawa.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { place_id } = req.query;
  if (!place_id) return res.status(400).json({ error: 'place_id は必須です' });

  const GKEY = process.env.GOOGLE_PLACES_KEY;
  if (!GKEY) return res.status(500).json({ error: 'APIキーが設定されていません' });

  try {
    const fields = [
      'place_id','name','vicinity','formatted_address',
      'geometry','opening_hours','rating','user_ratings_total',
      'reviews','types','wheelchair_accessible_entrance',
      'website','formatted_phone_number',
    ].join(',');

    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', place_id);
    url.searchParams.set('fields', fields);
    url.searchParams.set('language', 'ja');
    url.searchParams.set('key', GKEY);

    const r = await fetch(url.toString());
    const json = await r.json();
    const p = json.result;
    if (!p) return res.status(404).json({ error: '施設が見つかりません' });

    const reviews = (p.reviews || []).map(rv => ({
      author: rv.author_name,
      rating: rv.rating,
      text: rv.text,
      time: rv.relative_time_description,
    }));

    const reviewTexts = reviews.map(r => r.text).filter(Boolean);
    const babyInfo = analyzeReviews(p.name, reviewTexts, p);

    return res.status(200).json({ result: p, reviews, babyInfo });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function analyzeReviews(name, reviews, place) {
  const text = reviews.join(' ').toLowerCase();
  const types = place.types || [];

  const KW_DIAPER    = ['おむつ','オムツ','diaper','changing','ベビーシート','赤ちゃん','ベビールーム','乳幼児'];
  const KW_NURSING   = ['授乳','nursing','哺乳','mother room','ベビールーム','授乳室','授乳スペース'];
  const KW_BARRIER   = ['バリアフリー','車椅子','wheelchair','多目的','ユニバーサル','accessible','エレベーター'];
  const KW_OSTO      = ['オストメイト','ostomate','ストーマ'];
  const KW_HOT_WATER = ['お湯','給湯','調乳','hot water'];
  const KW_MICROWAVE = ['電子レンジ','レンジ','microwave'];
  const KW_MALE_OK   = ['パパ','男性も','お父さん','fathers','パパも入'];
  const KW_CLEAN     = ['清潔','きれい','綺麗','clean'];
  const KW_DIRTY     = ['汚い','不衛生','臭い','dirty'];

  const hasDiaper    = KW_DIAPER.some(k    => text.includes(k.toLowerCase()));
  const hasNursing   = KW_NURSING.some(k   => text.includes(k.toLowerCase()));
  const hasBarrier   = KW_BARRIER.some(k   => text.includes(k.toLowerCase())) || place.wheelchair_accessible_entrance;
  const hasOsto      = KW_OSTO.some(k      => text.includes(k.toLowerCase()));
  const hasHotWater  = KW_HOT_WATER.some(k => text.includes(k.toLowerCase()));
  const hasMicrowave = KW_MICROWAVE.some(k => text.includes(k.toLowerCase()));
  const isMaleOk     = KW_MALE_OK.some(k   => text.includes(k.toLowerCase()));
  const isClean      = KW_CLEAN.some(k     => text.includes(k.toLowerCase()));
  const isDirty      = KW_DIRTY.some(k     => text.includes(k.toLowerCase()));

  const isMall    = types.some(t => ['shopping_mall','department_store'].includes(t));
  const isStation = types.some(t => ['train_station','subway_station','transit_station'].includes(t));
  const isHosp    = types.some(t => ['hospital'].includes(t));

  const tags = [];
  if (hasDiaper || isMall)               tags.push('diaper');
  if (hasNursing || isMall)              tags.push('nursing');
  if (hasBarrier || isStation || isHosp) tags.push('barrier');
  if (hasOsto)                           tags.push('ostomate');
  if (!tags.length)                      tags.push('barrier');

  const feats = [];
  if (hasDiaper)            feats.push('🍼 おむつ替え台の記載あり');
  if (hasNursing)           feats.push('🤱 授乳室の記載あり');
  if (hasBarrier)           feats.push('♿ バリアフリー対応');
  if (hasOsto)              feats.push('🏥 オストメイト設備あり');
  if (hasHotWater)          feats.push('♨️ お湯・調乳設備あり');
  if (hasMicrowave)         feats.push('📦 電子レンジあり');
  if (isMaleOk)             feats.push('👨 パパ・男性も入室可');
  if (isClean && !isDirty)  feats.push('✨ 清潔との口コミあり');
  if (isDirty)              feats.push('⚠️ 清潔感に関する指摘あり');
  if (isMall)               feats.push('🏬 大型商業施設');
  if (isStation)            feats.push('🚃 駅施設');

  const hits = [hasDiaper, hasNursing, hasBarrier, hasOsto].filter(Boolean).length;

  return {
    tags, feats,
    hasDiaper, hasNursing, hasBarrier, hasOsto,
    hasHotWater, hasMicrowave, isMaleOk, isClean, isDirty,
    confidence: hits >= 2 ? 'high' : hits === 1 ? 'mid' : isMall || isStation ? 'mid' : 'low',
    reviewCount: reviews.length,
  };
}
