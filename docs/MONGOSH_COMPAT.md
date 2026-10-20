# mongosh compatibility

LumioNG runs scripts in an embedded JavaScript engine with a mongosh-style shim. This page lists the methods the shim implements; calling any other method fails with `... is not supported in LumioNG (see Help → mongosh compatibility)`.

<!-- Generated from src-tauri/src/script/prelude.js. Do not edit by hand: run
UPDATE_COMPAT_DOC=1 cargo test --manifest-path src-tauri/Cargo.toml prelude_compat_doc_is_in_sync -->

Also available: `print()`, `printjson()`, `console.log/info/warn/error`, `load("saved query name")` (runs a saved query in the same context, up to 8 levels deep), and the BSON helpers (`ObjectId`, `ISODate`, `NumberLong`, `NumberInt`, `NumberDecimal`, `UUID`, `BinData`, `Timestamp`, `MinKey`, `MaxKey`). Output is limited to 1,000 lines per second. `db.<name>` is shorthand for `db.getCollection("<name>")`.

## Collection

| Method | Status |
| --- | --- |
| `db.<coll>.aggregate()` | Supported |
| `db.<coll>.bulkWrite()` | Supported |
| `db.<coll>.count()` | Supported |
| `db.<coll>.countDocuments()` | Supported |
| `db.<coll>.createIndex()` | Supported |
| `db.<coll>.createIndexes()` | Supported |
| `db.<coll>.dataSize()` | Supported |
| `db.<coll>.deleteMany()` | Supported |
| `db.<coll>.deleteOne()` | Supported |
| `db.<coll>.distinct()` | Supported |
| `db.<coll>.drop()` | Supported |
| `db.<coll>.dropIndex()` | Supported |
| `db.<coll>.dropIndexes()` | Supported |
| `db.<coll>.estimatedDocumentCount()` | Supported |
| `db.<coll>.explain()` | Supported |
| `db.<coll>.find()` | Supported |
| `db.<coll>.findAndModify()` | Supported |
| `db.<coll>.findOne()` | Supported |
| `db.<coll>.findOneAndDelete()` | Supported |
| `db.<coll>.findOneAndReplace()` | Supported |
| `db.<coll>.findOneAndUpdate()` | Supported |
| `db.<coll>.getFullName()` | Supported |
| `db.<coll>.getIndexes()` | Supported |
| `db.<coll>.getName()` | Supported |
| `db.<coll>.hideIndex()` | Supported |
| `db.<coll>.initializeOrderedBulkOp()` | Supported |
| `db.<coll>.initializeUnorderedBulkOp()` | Supported |
| `db.<coll>.insert()` | Supported |
| `db.<coll>.insertMany()` | Supported |
| `db.<coll>.insertOne()` | Supported |
| `db.<coll>.isCapped()` | Supported |
| `db.<coll>.latencyStats()` | Supported |
| `db.<coll>.reIndex()` | Supported |
| `db.<coll>.remove()` | Supported |
| `db.<coll>.renameCollection()` | Supported |
| `db.<coll>.replaceOne()` | Supported |
| `db.<coll>.stats()` | Supported |
| `db.<coll>.storageSize()` | Supported |
| `db.<coll>.totalIndexSize()` | Supported |
| `db.<coll>.totalSize()` | Supported |
| `db.<coll>.unhideIndex()` | Supported |
| `db.<coll>.update()` | Supported |
| `db.<coll>.updateMany()` | Supported |
| `db.<coll>.updateOne()` | Supported |
| `db.<coll>.validate()` | Supported |

## Database

| Method | Status |
| --- | --- |
| `db.adminCommand()` | Supported |
| `db.aggregate()` | Supported |
| `db.changeUserPassword()` | Supported |
| `db.commandHelp()` | Supported |
| `db.createCollection()` | Supported |
| `db.createRole()` | Supported |
| `db.createUser()` | Supported |
| `db.createView()` | Supported |
| `db.currentOp()` | Supported |
| `db.dropAllRoles()` | Supported |
| `db.dropAllUsers()` | Supported |
| `db.dropDatabase()` | Supported |
| `db.dropRole()` | Supported |
| `db.dropUser()` | Supported |
| `db.getCollection()` | Supported |
| `db.getCollectionInfos()` | Supported |
| `db.getCollectionNames()` | Supported |
| `db.getLog()` | Supported |
| `db.getLogComponents()` | Supported |
| `db.getName()` | Supported |
| `db.getProfilingStatus()` | Supported |
| `db.getRole()` | Supported |
| `db.getRoles()` | Supported |
| `db.getSiblingDB()` | Supported |
| `db.getUser()` | Supported |
| `db.getUsers()` | Supported |
| `db.grantPrivilegesToRole()` | Supported |
| `db.grantRolesToRole()` | Supported |
| `db.grantRolesToUser()` | Supported |
| `db.hello()` | Supported |
| `db.hostInfo()` | Supported |
| `db.killOp()` | Supported |
| `db.listCommands()` | Supported |
| `db.revokePrivilegesFromRole()` | Supported |
| `db.revokeRolesFromRole()` | Supported |
| `db.revokeRolesFromUser()` | Supported |
| `db.runCommand()` | Supported |
| `db.serverBuildInfo()` | Supported |
| `db.serverCmdLineOpts()` | Supported |
| `db.serverStatus()` | Supported |
| `db.setLogLevel()` | Supported |
| `db.setProfilingLevel()` | Supported |
| `db.stats()` | Supported |
| `db.updateRole()` | Supported |
| `db.updateUser()` | Supported |
| `db.version()` | Supported |

## Cursor

| Method | Status |
| --- | --- |
| `<cursor>.count()` | Supported |
| `<cursor>.explain()` | Supported |
| `<cursor>.forEach()` | Supported |
| `<cursor>.hasNext()` | Supported |
| `<cursor>.hint()` | Supported |
| `<cursor>.limit()` | Supported |
| `<cursor>.map()` | Supported |
| `<cursor>.maxTimeMS()` | Supported |
| `<cursor>.next()` | Supported |
| `<cursor>.pretty()` | Supported |
| `<cursor>.projection()` | Supported |
| `<cursor>.size()` | Supported |
| `<cursor>.skip()` | Supported |
| `<cursor>.sort()` | Supported |
| `<cursor>.toArray()` | Supported |

## Replica set (`rs`)

| Method | Status |
| --- | --- |
| `rs.add()` | Supported |
| `rs.addArb()` | Supported |
| `rs.conf()` | Supported |
| `rs.config()` | Supported |
| `rs.freeze()` | Supported |
| `rs.initiate()` | Supported |
| `rs.printReplicationInfo()` | Supported |
| `rs.printSecondaryReplicationInfo()` | Supported |
| `rs.reconfig()` | Supported |
| `rs.remove()` | Supported |
| `rs.status()` | Supported |
| `rs.stepDown()` | Supported |
| `rs.syncFrom()` | Supported |

## Sharding (`sh`)

| Method | Status |
| --- | --- |
| `sh.addShard()` | Supported |
| `sh.addShardToZone()` | Supported |
| `sh.disableAutoSplit()` | Supported |
| `sh.enableAutoSplit()` | Supported |
| `sh.enableSharding()` | Supported |
| `sh.getBalancerState()` | Supported |
| `sh.isBalancerRunning()` | Supported |
| `sh.moveChunk()` | Supported |
| `sh.removeShardFromZone()` | Supported |
| `sh.shardCollection()` | Supported |
| `sh.splitAt()` | Supported |
| `sh.splitFind()` | Supported |
| `sh.startBalancer()` | Supported |
| `sh.status()` | Supported |
| `sh.stopBalancer()` | Supported |
| `sh.updateZoneKeyRange()` | Supported |
