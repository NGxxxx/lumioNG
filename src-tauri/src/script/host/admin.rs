//! Admin/command-passthrough bindings: `__runCommand` (per-db) and `__adminCommand` (always against `admin`), each gated by the write/DDL denylist when the connection is read-only.
use super::{is_write_command, run_blocking, HostCtx};
use rquickjs::{Ctx, Function, Result as JsResult};

/// Rejects a write/DDL command on a read-only connection -- shared by `__runCommand`/`__adminCommand`.
fn guard_write(h: &HostCtx, cmd: &mongodb::bson::Document) -> Result<(), crate::error::AppError> {
    if h.read_only && is_write_command(cmd) {
        return Err(crate::error::AppError::Query(
            "Connection is read-only".into(),
        ));
    }
    Ok(())
}

// ── __runCommand ──────────────────────────────────────────────────────────────

pub(super) fn bind_run_command(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db, cmdJson
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, db: String, cmd_json: String| -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                use crate::bson_json::doc_to_canonical_string;

                let cmd = crate::json_bson::canonical_string_to_doc(&cmd_json)?;
                guard_write(&h, &cmd)?;
                let reply = h.client.database(&db).run_command(cmd).await?;
                doc_to_canonical_string(reply)
            })
        },
    )?;
    ctx.globals().set("__runCommand", f)?;
    Ok(())
}

// ── __adminCommand ──────────────────────────────────────────────────────────────

pub(super) fn bind_admin_command(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: cmdJson — always runs against the `admin` database.
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, cmd_json: String| -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                use crate::bson_json::doc_to_canonical_string;

                let cmd = crate::json_bson::canonical_string_to_doc(&cmd_json)?;
                guard_write(&h, &cmd)?;
                let reply = h.client.database("admin").run_command(cmd).await?;
                doc_to_canonical_string(reply)
            })
        },
    )?;
    ctx.globals().set("__adminCommand", f)?;
    Ok(())
}

#[cfg(test)]
mod prelude_admin_tests {
    use rquickjs::{Context, Runtime};

    const PRELUDE: &str = include_str!("../prelude.js");

    // Captures the db + command sent to __runCommand and the command sent to __adminCommand.
    // Returns a canned reply rich enough for chained helpers (stats fields, replSet config, cursor).
    const ADMIN_STUBS: &str = r#"
globalThis.__lastCmdDb = null;
globalThis.__lastCmd = null;
globalThis.__lastAdminCmd = null;
globalThis.__lastAggPipeline = null;
function __reply(){
  return JSON.stringify({
    ok: 1, version: "7.0.0",
    size: {$numberLong:"100"}, storageSize: {$numberLong:"200"},
    totalIndexSize: {$numberLong:"50"}, count: {$numberLong:"3"}, capped: false,
    config: {_id:"rs0", version: 1, members: [{_id:0, host:"h0:27017"}]},
    cursor: {firstBatch: []}, value: null,
    logComponentVerbosity: {verbosity: 0}, shards: []
  });
}
globalThis.__runCommand = function(db, cmd){ __lastCmdDb = db; __lastCmd = cmd; return __reply(); };
globalThis.__adminCommand = function(cmd){ __lastAdminCmd = cmd; return __reply(); };
globalThis.__aggregate = function(db, coll, pipeline, opts){
  __lastAggPipeline = pipeline;
  return JSON.stringify({handle: 1, rows: [], exhausted: true});
};
globalThis.__cursorFetch = function(){ return JSON.stringify({rows: [], exhausted: true}); };
globalThis.__cursorClose = function(){};
globalThis.__find = function(){ return JSON.stringify({handle: 1, rows: [], exhausted: true}); };
globalThis.__count = function(){ return JSON.stringify({$numberLong:"0"}); };
globalThis.__distinct = function(){ return "[]"; };
globalThis.__listCollections = function(){ return "[]"; };
globalThis.__write = function(){ return JSON.stringify({acknowledged:true}); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
"#;

    /// Eval the prelude + user JS, then return the string value of `expr`
    /// (e.g. "__lastCmd", "__lastAdminCmd", "String(db.c.dataSize())").
    fn capture(user_js: &str, expr: &str) -> String {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(ADMIN_STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            let v: rquickjs::String = ctx.eval(expr).unwrap();
            v.to_string().unwrap()
        })
    }

    #[test]
    fn admin_command_global_is_callable_from_prelude() {
        // db.adminCommand routes through __adminCommand (added in Task 3, but the host stub
        // exists now). This smoke-tests the harness itself.
        let got = capture(r#"db.runCommand({ping:1})"#, "__lastCmd");
        assert!(got.contains(r#""ping":1"#) || got.contains(r#""ping":{"$numberInt":"1"}"#));
        assert_eq!(capture(r#"db.runCommand({ping:1})"#, "__lastCmdDb"), "testdb");
    }

    #[test]
    fn db_stats_builds_dbstats_with_scale() {
        assert!(capture(r#"db.stats(1024)"#, "__lastCmd").contains(r#""dbStats":1"#));
        assert!(capture(r#"db.stats(1024)"#, "__lastCmd").contains(r#""scale":{"$numberInt":"1024"}"#)
             || capture(r#"db.stats(1024)"#, "__lastCmd").contains(r#""scale":1024"#));
        assert_eq!(capture(r#"db.stats()"#, "__lastCmdDb"), "testdb");
    }

    #[test]
    fn server_status_routes_to_admin() {
        assert!(capture(r#"db.serverStatus()"#, "__lastAdminCmd").contains(r#""serverStatus":1"#));
    }

    #[test]
    fn kill_op_builds_killop_command_on_admin() {
        let c = capture(r#"db.killOp(123)"#, "__lastAdminCmd");
        assert!(c.contains(r#""killOp":1"#));
        assert!(c.contains(r#""op":"#));
    }

    #[test]
    fn version_returns_build_info_version_string() {
        assert_eq!(capture(r#"db.version()"#, "String(db.version())"), "7.0.0");
    }

    #[test]
    fn set_profiling_level_builds_profile_command() {
        let c = capture(r#"db.setProfilingLevel(1, {slowms: 50})"#, "__lastCmd");
        assert!(c.contains(r#""profile":{"$numberInt":"1"}"#) || c.contains(r#""profile":1"#));
        assert!(c.contains(r#""slowms":{"$numberInt":"50"}"#) || c.contains(r#""slowms":50"#));
    }

    #[test]
    fn create_collection_builds_create_command() {
        let c = capture(r#"db.createCollection("logs", {capped:true, size:1000})"#, "__lastCmd");
        assert!(c.contains(r#""create":"logs""#));
        assert!(c.contains(r#""capped":true"#));
    }

    #[test]
    fn create_view_builds_create_with_viewon_and_pipeline() {
        let c = capture(r#"db.createView("v","src",[{$match:{a:1}}])"#, "__lastCmd");
        assert!(c.contains(r#""create":"v""#));
        assert!(c.contains(r#""viewOn":"src""#));
        assert!(c.contains(r#""pipeline":[{"$match""#));
    }

    #[test]
    fn drop_database_builds_dropdatabase_command() {
        assert!(capture(r#"db.dropDatabase()"#, "__lastCmd").contains(r#""dropDatabase":1"#));
    }

    #[test]
    fn get_collection_infos_builds_list_collections_with_filter() {
        let c = capture(r#"db.getCollectionInfos({type:"view"})"#, "__lastCmd");
        assert!(c.contains(r#""listCollections":1"#));
        assert!(c.contains(r#""filter":{"type":"view"}"#));
    }

    #[test]
    fn coll_stats_builds_collstats_command() {
        let c = capture(r#"db.c.stats()"#, "__lastCmd");
        assert!(c.contains(r#""collStats":"c""#));
    }

    #[test]
    fn data_size_coerces_numberlong_to_number() {
        // stub size is {$numberLong:"100"}
        assert_eq!(capture(r#"db.c.dataSize()"#, "String(db.c.dataSize())"), "100");
    }

    #[test]
    fn total_size_sums_storage_and_index() {
        // storageSize 200 + totalIndexSize 50 = 250
        assert_eq!(capture(r#"db.c.totalSize()"#, "String(db.c.totalSize())"), "250");
    }

    #[test]
    fn validate_builds_validate_command() {
        let c = capture(r#"db.c.validate({full:true})"#, "__lastCmd");
        assert!(c.contains(r#""validate":"c""#));
        assert!(c.contains(r#""full":true"#));
    }

    #[test]
    fn latency_stats_builds_collstats_aggregation() {
        capture(r#"db.c.latencyStats()"#, "__lastAggPipeline");
        let p = capture(r#"db.c.latencyStats()"#, "JSON.stringify(__lastAggPipeline)");
        assert!(p.contains(r#"$collStats"#));
        assert!(p.contains(r#"latencyStats"#));
    }

    #[test]
    fn cursor_explain_builds_explain_find_command() {
        let c = capture(r#"db.c.find({a:1}).explain("executionStats")"#, "__lastCmd");
        assert!(c.contains(r#""explain":{"#));
        assert!(c.contains(r#""find":"c""#));
        assert!(c.contains(r#""verbosity":"executionStats""#));
    }

    #[test]
    fn coll_explain_aggregate_builds_explain_aggregate_command() {
        let c = capture(r#"db.c.explain().aggregate([{$match:{a:1}}])"#, "__lastCmd");
        assert!(c.contains(r#""explain":{"#));
        assert!(c.contains(r#""aggregate":"c""#));
    }

    #[test]
    fn create_user_builds_create_user_command() {
        let c = capture(r#"db.createUser({user:"alice", pwd:"pw", roles:["readWrite"]})"#, "__lastCmd");
        assert!(c.contains(r#""createUser":"alice""#));
        assert!(c.contains(r#""pwd":"pw""#));
        assert!(c.contains(r#""roles":["readWrite"]"#));
        assert_eq!(capture(r#"db.createUser({user:"alice", pwd:"pw", roles:[]})"#, "__lastCmdDb"), "testdb");
    }

    #[test]
    fn drop_user_and_drop_all_users() {
        assert!(capture(r#"db.dropUser("bob")"#, "__lastCmd").contains(r#""dropUser":"bob""#));
        assert!(capture(r#"db.dropAllUsers()"#, "__lastCmd").contains(r#""dropAllUsersFromDatabase":1"#));
    }

    #[test]
    fn change_user_password_builds_update_user() {
        let c = capture(r#"db.changeUserPassword("bob","newpw")"#, "__lastCmd");
        assert!(c.contains(r#""updateUser":"bob""#));
        assert!(c.contains(r#""pwd":"newpw""#));
    }

    #[test]
    fn grant_roles_to_user_command() {
        let c = capture(r#"db.grantRolesToUser("bob",["read"])"#, "__lastCmd");
        assert!(c.contains(r#""grantRolesToUser":"bob""#));
        assert!(c.contains(r#""roles":["read"]"#));
    }

    #[test]
    fn get_user_builds_users_info_with_db() {
        let c = capture(r#"db.getUser("bob")"#, "__lastCmd");
        assert!(c.contains(r#""usersInfo":{"user":"bob","db":"testdb"}"#));
    }

    #[test]
    fn create_role_builds_create_role_command() {
        let c = capture(r#"db.createRole({role:"r1", privileges:[], roles:[]})"#, "__lastCmd");
        assert!(c.contains(r#""createRole":"r1""#));
        assert!(c.contains(r#""privileges":[]"#));
    }

    #[test]
    fn drop_role_and_drop_all_roles() {
        assert!(capture(r#"db.dropRole("r1")"#, "__lastCmd").contains(r#""dropRole":"r1""#));
        assert!(capture(r#"db.dropAllRoles()"#, "__lastCmd").contains(r#""dropAllRolesFromDatabase":1"#));
    }

    #[test]
    fn grant_privileges_to_role_command() {
        let c = capture(r#"db.grantPrivilegesToRole("r1",[{resource:{db:"d",collection:""},actions:["find"]}])"#, "__lastCmd");
        assert!(c.contains(r#""grantPrivilegesToRole":"r1""#));
        assert!(c.contains(r#""privileges":[{"#));
    }

    #[test]
    fn get_role_builds_roles_info_with_db() {
        let c = capture(r#"db.getRole("r1")"#, "__lastCmd");
        assert!(c.contains(r#""rolesInfo":{"role":"r1","db":"testdb"}"#));
    }

    #[test]
    fn rs_status_and_conf_route_to_admin() {
        assert!(capture(r#"rs.status()"#, "__lastAdminCmd").contains(r#""replSetGetStatus":1"#));
        assert!(capture(r#"rs.conf()"#, "__lastAdminCmd").contains(r#""replSetGetConfig":1"#));
    }

    #[test]
    fn rs_initiate_and_reconfig_commands() {
        assert!(capture(r#"rs.initiate({_id:"rs0",members:[]})"#, "__lastAdminCmd").contains(r#""replSetInitiate":{"#));
        let c = capture(r#"rs.reconfig({_id:"rs0",version:2,members:[]}, {force:true})"#, "__lastAdminCmd");
        assert!(c.contains(r#""replSetReconfig":{"#));
        assert!(c.contains(r#""force":true"#));
    }

    #[test]
    fn rs_add_reads_conf_then_reconfigs_with_new_host() {
        // conf() stub returns config with member h0; add("h1:27017") must reconfig including h1.
        let c = capture(r#"rs.add("h1:27017")"#, "__lastAdminCmd");
        assert!(c.contains(r#""replSetReconfig":{"#));
        assert!(c.contains("h1:27017"));
    }

    #[test]
    fn rs_step_down_and_freeze_commands() {
        assert!(capture(r#"rs.freeze(120)"#, "__lastAdminCmd").contains(r#""replSetFreeze""#));
        assert!(capture(r#"rs.stepDown(60)"#, "__lastAdminCmd").contains(r#""replSetStepDown""#));
    }

    #[test]
    fn sh_enable_sharding_and_shard_collection() {
        assert!(capture(r#"sh.enableSharding("mydb")"#, "__lastAdminCmd").contains(r#""enableSharding":"mydb""#));
        let c = capture(r#"sh.shardCollection("mydb.c",{x:1},true)"#, "__lastAdminCmd");
        assert!(c.contains(r#""shardCollection":"mydb.c""#));
        assert!(c.contains(r#""key":{"x""#));
        assert!(c.contains(r#""unique":true"#));
    }

    #[test]
    fn sh_add_shard_and_move_chunk() {
        assert!(capture(r#"sh.addShard("rs1/h:27017")"#, "__lastAdminCmd").contains(r#""addShard":"rs1/h:27017""#));
        let c = capture(r#"sh.moveChunk("mydb.c",{x:5},"shard0001")"#, "__lastAdminCmd");
        assert!(c.contains(r#""moveChunk":"mydb.c""#));
        assert!(c.contains(r#""find":{"x""#));
        assert!(c.contains(r#""to":"shard0001""#));
    }

    #[test]
    fn sh_split_and_balancer_controls() {
        assert!(capture(r#"sh.splitAt("mydb.c",{x:5})"#, "__lastAdminCmd").contains(r#""split":"mydb.c""#));
        assert!(capture(r#"sh.startBalancer()"#, "__lastAdminCmd").contains(r#""balancerStart":1"#));
        assert!(capture(r#"sh.stopBalancer()"#, "__lastAdminCmd").contains(r#""balancerStop":1"#));
        assert!(capture(r#"sh.isBalancerRunning()"#, "__lastAdminCmd").contains(r#""balancerStatus":1"#));
    }

    #[test]
    fn sh_zone_management_commands() {
        assert!(capture(r#"sh.addShardToZone("shard0","z1")"#, "__lastAdminCmd").contains(r#""addShardToZone":"shard0""#));
        let c = capture(r#"sh.updateZoneKeyRange("mydb.c",{x:0},{x:10},"z1")"#, "__lastAdminCmd");
        assert!(c.contains(r#""updateZoneKeyRange":"mydb.c""#));
        assert!(c.contains(r#""zone":"z1""#));
    }

    #[test]
    fn slice4_ddl_writes_are_in_denylist() {
        use mongodb::bson::doc;
        for k in ["create", "createView", "dropDatabase", "renameCollection",
                  "createUser", "updateUser", "createRole", "grantRolesToUser"] {
            assert!(super::is_write_command(&doc! { k: 1 }), "{k} must be read-only gated");
        }
    }

    #[test]
    fn slice4_cluster_admin_is_intentionally_not_gated() {
        use mongodb::bson::doc;
        // rs.*/sh.* reconfig is cluster admin, deliberately outside the data read-only lock.
        for k in ["replSetReconfig", "addShard", "moveChunk", "balancerStart"] {
            assert!(!super::is_write_command(&doc! { k: 1 }), "{k} is cluster-admin, not a data write");
        }
    }
}
