function previousWeekRange(now = new Date()) {
  const dow = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(thisMonday.getDate() - 7);
  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  prevSunday.setHours(23, 59, 59, 999);
  return { start: prevMonday.getTime(), end: prevSunday.getTime() };
}

module.exports = { previousWeekRange };
