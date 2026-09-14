import { useEffect, useRef, useState } from "react";
import { getWorkspace, putWorkspace, UnauthorizedError } from "./api";

/** 与旧版 useStored<T> 签名完全一致，内部把存储后端从 localStorage 换成 bff 的 /api/workspace。
 *  挂载时拉一次远端数据（没有就用种子初始化），之后每次变化防抖 800ms 整坨 PUT 回去——
 *  跟以前"每次变化整坨 JSON.stringify 写 localStorage"的写法保持同一种心智模型，只是换了存放的地方。 */
export function useRemoteStore<T>(initial: () => T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 首次拉到远端数据后会触发一次"变化"，那次不需要立刻又写回服务器
  const skipNextWrite = useRef(true);

  useEffect(() => {
    let cancelled = false;
    getWorkspace()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setValue(data as T);
        } else {
          // 全新账号：服务端还没有工作区数据，用种子初始化的同时立刻写回去——
          // 否则每次刷新都会重新生成一份带新时间戳的种子，跟"持久化"的承诺不符。
          skipNextWrite.current = false;
        }
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // 401 说明登录态已失效，全局登出流程正在切回登录页——这时再显示"同步失败"是误导。
        // 仍置 loaded，让状态机保持自洽（skipNextWrite 初值为 true，不会触发回写）。
        if (e instanceof UnauthorizedError) {
          setLoaded(true);
          return;
        }
        // 网络不通 / 5xx：保留登录态，按原来的"暂时只存在本页"提示
        setError(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      putWorkspace(value)
        .then(() => setError(false))
        // 401 已经走全局登出（apiFetch 通知），不再叠加"同步失败"横幅
        .catch((e: unknown) => setError(!(e instanceof UnauthorizedError)));
    }, 800);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, loaded]);

  return [value, setValue, error] as const;
}
