import {
  listConnections,
  saveConnection,
  deleteConnection,
  type SavedConnection,
} from "../api/connections";
import { connect } from "../api/connection";
import { errorMessage } from "../api/errors";
import { validateConnection } from "../domain/connections";
import { maskUri } from "../domain/uri";
import { commandLog } from "./commandLog.svelte";
import { connectCmd } from "../domain/mongosh";

const DEFAULT_URI = "mongodb://localhost:27017";

/** Registry các connection đã lưu + form thêm/sửa + connect. Component chỉ render/bind. */
export function createConnectionRegistry() {
  let list = $state<SavedConnection[]>([]);
  let error = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let label = $state("");
  let uri = $state(DEFAULT_URI);
  let editingId = $state<number | null>(null);
  let connecting = $state(false);

  async function load() {
    error = null;
    try {
      list = await listConnections();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function clearForm() {
    editingId = null;
    label = "";
    uri = DEFAULT_URI;
    formError = null;
  }

  async function save() {
    const v = validateConnection(label, uri);
    if (!v.ok) {
      formError = v.error;
      return;
    }
    formError = null;
    try {
      list = await saveConnection(editingId, label.trim(), uri.trim());
      clearForm();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function remove(id: number) {
    try {
      list = await deleteConnection(id);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function edit(c: SavedConnection) {
    editingId = c.id;
    label = c.label;
    uri = c.uri;
    formError = null;
  }

  async function connectTo(connUri: string): Promise<boolean> {
    connecting = true;
    error = null;
    try {
      await connect(connUri);
      commandLog.push(connectCmd(maskUri(connUri)));
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      connecting = false;
    }
  }

  return {
    get list() {
      return list;
    },
    get error() {
      return error;
    },
    get formError() {
      return formError;
    },
    get editingId() {
      return editingId;
    },
    get connecting() {
      return connecting;
    },
    get label() {
      return label;
    },
    set label(v: string) {
      label = v;
    },
    get uri() {
      return uri;
    },
    set uri(v: string) {
      uri = v;
    },
    load,
    save,
    remove,
    edit,
    clearForm,
    connectTo,
  };
}
