import http from "node:http";

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function listenOnLoopback(...args) {
  const next = args.slice();
  if (typeof next[1] === "function" || next[1] === undefined) next.splice(1, 0, "127.0.0.1");
  else if (next[1] === "0.0.0.0" || next[1] === "::") next[1] = "127.0.0.1";
  return listen.apply(this, next);
};
