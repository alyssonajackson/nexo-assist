import { MongoClient, MongoServerError } from 'mongodb'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Multi-document transactions and change streams need a replica set. Atlas always has one;
 * locally `mongo` runs with `--replSet rs0` and this initiates it once (single node).
 */
export async function ensureReplicaSet(uri: string, memberHost: string) {
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 30_000 })
  await client.connect()
  try {
    const admin = client.db('admin')
    try {
      await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: memberHost }] } })
      console.log(`mongo: replica set rs0 initiated (${memberHost})`)
    } catch (err) {
      // 23 = AlreadyInitialized
      if (!(err instanceof MongoServerError && err.code === 23)) throw err
    }
    for (let i = 0; i < 60; i++) {
      const hello = await admin.command({ hello: 1 })
      if (hello.isWritablePrimary) return
      await sleep(500)
    }
    throw new Error('mongo: replica set did not elect a primary in time')
  } finally {
    await client.close()
  }
}
