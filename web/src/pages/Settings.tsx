import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Plus, Trash2 } from "lucide-react";
import type { AuthUser } from "../lib/api";
import {
  createUser,
  deleteUser,
  listUsers,
  resetPassword,
  type AdminUser,
} from "../lib/admin";
import { Badge, Dialog, Empty, Notice, formatTime } from "../components/UI";

/** 设置页（#settings）：目前只有用户管理。入口在侧边栏、仅管理员可见，
 *  服务端 requireAdmin 才是真正的闸门——这里只是界面。
 *
 *  演示账号（isDemo）由服务端硬拦：不可删除、不可重置密码，所以两个操作按钮都禁掉，
 *  免得管理员点了才吃一个 403。 */
export default function Settings({
  currentUser,
  notify,
}: {
  currentUser: AuthUser;
  notify: (message: string) => void;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null); // null = 加载中
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  // 删除用两步确认（与侧边栏任务删除同一套交互）：第一次点变成"确认"，再点一次才真删
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    listUsers()
      .then((rows) => {
        setUsers(rows);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  async function remove(u: AdminUser) {
    try {
      await deleteUser(u.id);
      setConfirming(null);
      notify(`已删除账号 ${u.displayName}`);
      load();
    } catch (e) {
      setConfirming(null);
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>设置</h1>
          <p>管理可登录本平台的账号：新建、重置密码、删除。演示账号受服务端保护，不可删除或改密。</p>
        </div>
        <button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={16} />
          新建账号
        </button>
      </div>

      {error && <Notice warning>{error}</Notice>}

      {users === null ? (
        <Notice>正在加载账号列表…</Notice>
      ) : !users.length ? (
        <Empty title="还没有账号" description="新建一个账号，对方即可登录使用。" />
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>账号</th>
                  <th>角色</th>
                  <th>创建时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  const confirmingMe = confirming === u.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="task-name">
                          <div>
                            <strong>{u.displayName}</strong>
                            <small>{u.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {u.role === "admin" ? <Badge tone="blue">管理员</Badge> : <span className="secondary">普通用户</span>}
                        {u.isDemo && <Badge tone="amber">演示账号</Badge>}
                        {isSelf && <Badge>当前账号</Badge>}
                      </td>
                      <td>{formatTime(u.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="text-button"
                            disabled={u.isDemo}
                            title={u.isDemo ? "演示账号不允许重置密码" : "重置密码"}
                            onClick={() => setResetting(u)}
                          >
                            <KeyRound size={14} />
                            重置密码
                          </button>
                          <button
                            className={`row-delete${confirmingMe ? " confirming" : ""}`}
                            disabled={u.isDemo || isSelf}
                            title={
                              u.isDemo
                                ? "演示账号不允许删除"
                                : isSelf
                                  ? "不能删除当前登录的账号"
                                  : confirmingMe
                                    ? "再点一次确认删除"
                                    : "删除账号"
                            }
                            aria-label={confirmingMe ? `确认删除${u.displayName}` : `删除${u.displayName}`}
                            onClick={() => (confirmingMe ? remove(u) : setConfirming(u.id))}
                          >
                            {confirmingMe ? <Check size={13} /> : <Trash2 size={13} />}
                            {confirmingMe && "确认"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && (
        <Dialog title="新建账号" onClose={() => setCreating(false)}>
          <PasswordForm
            submitLabel="创建"
            // 新建时还要填邮箱和昵称；重置密码时这两个字段不出现
            withIdentity
            onCancel={() => setCreating(false)}
            onSubmit={async (email, password, displayName) => {
              await createUser(email, password, displayName);
              setCreating(false);
              notify("账号已创建，工作区为空白");
              load();
            }}
          />
        </Dialog>
      )}

      {resetting && (
        <Dialog title={`重置密码 · ${resetting.displayName}`} onClose={() => setResetting(null)}>
          <PasswordForm
            submitLabel="重置密码"
            hint={`为 ${resetting.email} 设置新密码，旧密码立即失效。`}
            onCancel={() => setResetting(null)}
            onSubmit={async (_email, password) => {
              await resetPassword(resetting.id, password);
              setResetting(null);
              notify("密码已重置");
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

/** 新建账号 / 重置密码共用的表单：两处都是"输密码 + 二次确认密码"，
 *  只是新建时多两个身份字段。 */
function PasswordForm({
  withIdentity = false,
  submitLabel,
  hint,
  onCancel,
  onSubmit,
}: {
  withIdentity?: boolean;
  submitLabel: string;
  hint?: string;
  onCancel: () => void;
  onSubmit: (email: string, password: string, displayName: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (withIdentity && (!email.trim() || !displayName.trim())) {
      setError("请填写邮箱和昵称。");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位。");
      return;
    }
    if (password !== again) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(email.trim(), password, displayName.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {hint && <p className="detail-description">{hint}</p>}
      {withIdentity && (
        <>
          <label className="field">
            昵称
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="怎么称呼对方" />
          </label>
          <label className="field">
            邮箱
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
            />
          </label>
        </>
      )}
      <label className="field">
        密码
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 6 位"
          autoComplete="new-password"
        />
      </label>
      <label className="field">
        确认密码
        <input
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          placeholder="再输一次"
          autoComplete="new-password"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <button className="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="button primary" onClick={submit} disabled={busy}>
          {busy ? "处理中…" : submitLabel}
        </button>
      </div>
    </>
  );
}
