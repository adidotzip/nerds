import { MongoClient } from "mongodb";

const DB_NAME = process.env.MONGODB_DB || "adi_rest_status";
const CHECKS_COLLECTION = "monitor_checks";
const META_COLLECTION = "monitoring_meta";
const RETENTION_SECONDS = 30 * 24 * 60 * 60;
const RESET_MARKER = "history-reset-v1";

let clientPromise;

async function getDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 5
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }

  const client = await clientPromise;
  const db = client.db(DB_NAME);
  const checks = db.collection(CHECKS_COLLECTION);
  const meta = db.collection(META_COLLECTION);

  await Promise.all([
    checks.createIndex({ serviceId: 1, timestamp: -1 }),
    checks.createIndex({ timestamp: 1 }, { expireAfterSeconds: RETENTION_SECONDS })
  ]);

  // One-time cleanup requested for the old history: preserve only genuine
  // outage checks from the last 24 hours. Never synthesize/backfill checks.
  const marker = await meta.findOne({ _id: RESET_MARKER });
  if (!marker) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await checks.deleteMany({
      $or: [
        { timestamp: { $lt: cutoff } },
        { status: { $ne: "down" } }
      ]
    });
    await meta.updateOne(
      { _id: RESET_MARKER },
      { $setOnInsert: { completedAt: new Date(), policy: "keep-real-outages-last-24h" } },
      { upsert: true }
    );
  }

  return { checks, db };
}

export async function saveChecks(records) {
  const { checks } = await getDatabase();
  if (!records.length) return;
  await checks.insertMany(records.map((record) => ({
    ...record,
    timestamp: new Date(record.timestamp)
  })));
}

export async function readChecks({ serviceId, since, limit = 5000 } = {}) {
  const { checks } = await getDatabase();
  const query = { timestamp: { $gte: since } };
  if (serviceId) query.serviceId = serviceId;
  const docs = await checks.find(query)
    .sort({ timestamp: 1 })
    .limit(Math.min(Math.max(limit, 1), 10000))
    .toArray();
  return docs.map(({ _id, timestamp, ...record }) => ({
    ...record,
    timestamp: new Date(timestamp).toISOString()
  }));
}

export async function readRecentChecks(since) {
  return readChecks({ since, limit: 10000 });
}
