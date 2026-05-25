/**
 * Simple module-level cache so pages can show data instantly when navigated
 * back to, without a loading spinner. Data is always revalidated in the
 * background — this just eliminates the blank/loading flash.
 *
 * Usage:
 *   const [items, setItems] = useState(pageCache.contacts ?? []);
 *   const load = async () => {
 *     const data = await api.contacts.list();
 *     pageCache.contacts = data;
 *     setItems(data);
 *   };
 *   useEffect(() => { load(); }, []); // always revalidates silently
 */
const pageCache = {};
export default pageCache;
