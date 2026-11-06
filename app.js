// Konfigurasi Firebase Projek ska-ppm-system
const firebaseConfig = {
  apiKey: "AIzaSyCUTwGoGfengsUkPO5a9mF-LYm2AwgR3-s",
  authDomain: "ska-ppm-system.firebaseapp.com",
  projectId: "ska-ppm-system",
  storageBucket: "ska-ppm-system.firebasestorage.app",
  messagingSenderId: "444173274865",
  appId: "1:444173274865:web:b06e6868b759483494e350",
  measurementId: "G-LB7ZJHTM7L"
};

// Inisialisasi Firebase & Firestore
let db = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
} catch (e) {
  console.warn("Ralat inisialisasi Firebase:", e);
}

document.addEventListener('alpine:init', () => {
  Alpine.data('ppmApp', () => ({
    currentView: 'main', // 'main', 'category_list', 'checklist'
    selectedReportType: 'CCTV', // 'CCTV', 'ACS', atau 'IP Phone'

    projectName: 'RTS LINK ICQC BUKIT CHAGAR',
    monthYear: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase(),
    currentDate: new Date().toISOString().split('T')[0],
    footerTitle: 'Maintenance Checklist / CCTV',
    footerProjectName: 'PREVENTIVE MAINTENANCE: RTS LINK ICQC BUKIT CHAGAR',
    notesDiscrepancies: 'Semua peralatan dan perkakasan berada dalam keadaan baik semasa ujian pencegahan dijalankan.',

    searchQuery: '',

    categories: JSON.parse(localStorage.getItem('ppm_categories') || JSON.stringify([
      'CCTV Camera',
      'Access Control',
      'IP Phone',
      'Network Switch',
      'Server / UPS'
    ])),
    newCategoryName: '',
    selectedCategoryTab: 'All',

    newAsset: {
      tag: '',
      category: 'CCTV Camera',
      model: '',
      level: 'GF',
      location: '',
      desc: 'DOME',
      ip: ''
    },

    phones: JSON.parse(localStorage.getItem('ppm_phones') || '[]'),
    cloudConnected: false,
    isSyncing: false,

    init() {
      this.initCloudListener();
    },

    // =========================================================================
    // PENYELARASAN AWAN (CLOUD SYNC LISTENER - FIRESTORE)
    // =========================================================================
    initCloudListener() {
      if (!db) return;
      this.isSyncing = true;

      // Pantau dokumen metadata pangkalan data secara langsung
      db.collection('ppm_system').doc('meta').onSnapshot(async (docSnapshot) => {
        if (docSnapshot.exists) {
          const meta = docSnapshot.data();
          const chunkCount = meta.chunkCount || 1;
          let combinedAssets = [];

          try {
            // Ambil semua serpihan data aset (chunks)
            for (let i = 0; i < chunkCount; i++) {
              const chunkDoc = await db.collection('ppm_system').doc(`assets_chunk_${i}`).get();
              if (chunkDoc.exists && chunkDoc.data().items) {
                combinedAssets = combinedAssets.concat(chunkDoc.data().items);
              }
            }

            if (combinedAssets.length > 0) {
              this.phones = combinedAssets;
              localStorage.setItem('ppm_phones', JSON.stringify(this.phones));
            }
            if (meta.categories) {
              this.categories = meta.categories;
              localStorage.setItem('ppm_categories', JSON.stringify(this.categories));
            }
            if (meta.notesDiscrepancies) this.notesDiscrepancies = meta.notesDiscrepancies;
            this.cloudConnected = true;
          } catch (err) {
            console.error("Gagal memuat turun data serpihan:", err);
          }
        } else {
          // Sekiranya awan masih kosong, muat naik data sedia ada
          if (this.phones.length > 0) {
            this.saveData();
          }
          this.cloudConnected = true;
        }
        this.isSyncing = false;
      }, (error) => {
        console.warn("Ralat sambungan Firestore:", error);
        this.cloudConnected = false;
        this.isSyncing = false;
      });
    },

    async saveData() {
      // 1. Simpan salinan ke storan setempat pelayar (offline fallback)
      localStorage.setItem('ppm_phones', JSON.stringify(this.phones));
      localStorage.setItem('ppm_categories', JSON.stringify(this.categories));

      // 2. Simpan ke Cloud Firestore dengan pecahan 400 aset per dokumen
      if (!db) return;
      this.isSyncing = true;

      try {
        const chunkSize = 400;
        const totalChunks = Math.ceil(this.phones.length / chunkSize) || 1;
        const batch = db.batch();

        for (let i = 0; i < totalChunks; i++) {
          const chunkItems = this.phones.slice(i * chunkSize, (i + 1) * chunkSize);
          const chunkRef = db.collection('ppm_system').doc(`assets_chunk_${i}`);
          batch.set(chunkRef, { items: chunkItems });
        }

        // Kemas kini dokumen meta
        const metaRef = db.collection('ppm_system').doc('meta');
        batch.set(metaRef, {
          totalAssets: this.phones.length,
          chunkCount: totalChunks,
          categories: this.categories,
          notesDiscrepancies: this.notesDiscrepancies,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        this.cloudConnected = true;
      } catch (err) {
        console.error("Ralat menyimpan ke Firestore:", err);
        this.cloudConnected = false;
      } finally {
        this.isSyncing = false;
      }
    },

    get searchResults() {
      if (!this.searchQuery.trim()) return [];
      const q = this.searchQuery.trim().toLowerCase();
      return this.phones.filter(item => 
        (item.tag && item.tag.toLowerCase().includes(q)) ||
        (item.ip && item.ip.toLowerCase().includes(q)) ||
        (item.location && item.location.toLowerCase().includes(q)) ||
        (item.model && item.model.toLowerCase().includes(q))
      );
    },

    get filteredAssetsByCategory() {
      if (this.selectedCategoryTab === 'All') {
        return this.phones;
      }
      return this.phones.filter(item => item.category === this.selectedCategoryTab);
    },

    get reportAssets() {
      if (this.selectedReportType === 'ACS') {
        return this.phones.filter(item => item.category === 'Access Control' || (item.tag && item.tag.includes('ACS')));
      } else if (this.selectedReportType === 'CCTV') {
        return this.phones.filter(item => item.category === 'CCTV Camera' || (item.tag && (item.tag.includes('CTV') || item.tag.includes('CAM'))));
      } else {
        return this.phones.filter(item => item.category === 'IP Phone' || (item.tag && item.tag.includes('TEL')));
      }
    },

    countByCategory(cat) {
      if (cat === 'All') return this.phones.length;
      return this.phones.filter(item => item.category === cat).length;
    },

    clearAllChecklistsBulk() {
      this.phones.forEach(item => {
        item.cctvPhysical = '';
        item.picQuality = '';
        item.viewFocus = '';
        item.recording = '';
        item.playback = '';
        item.ptzVolt = '';
        item.ptzPattern = '';

        item.magLock = '';
        item.readerIn = '';
        item.readerOut = '';
        item.pushBtn = '';
        item.breakGlass = '';
        item.doorSensor = '';
        item.keySwitch = '';

        item.physicalCheck = '';
        item.callIn = '';
        item.callOut = '';

        item.remarks = '';
      });
      this.saveData();
      alert('Semua ruangan checklist telah dikosongkan secara pukal!');
    },

    setAllChecklistsBulkOK() {
      this.phones.forEach(item => {
        const isPTZ = (item.desc && item.desc.toUpperCase().includes('PTZ')) || 
                      (item.model && item.model.toUpperCase().includes('PTZ'));

        item.cctvPhysical = 'OK';
        item.picQuality = 'OK';
        item.viewFocus = 'OK';
        item.recording = 'OK';
        item.playback = 'OK';
        item.ptzVolt = isPTZ ? 'OK' : 'N/A';
        item.ptzPattern = isPTZ ? 'OK' : 'N/A';

        item.magLock = 'OK';
        item.readerIn = 'OK';
        item.readerOut = 'N/A';
        item.pushBtn = 'OK';
        item.breakGlass = 'OK';
        item.doorSensor = 'OK';
        item.keySwitch = 'N/A';

        item.physicalCheck = 'OK';
        item.callIn = 'OK';
        item.callOut = 'OK';

        item.remarks = '';
      });
      this.saveData();
      alert('Semua ruangan checklist telah diisi dengan status lalai.');
    },

    addNewCategory() {
      const cat = this.newCategoryName.trim();
      if (!cat) {
        alert('Sila masukkan nama kategori!');
        return;
      }
      if (this.categories.includes(cat)) {
        alert('Kategori ini sudah wujud!');
        return;
      }
      this.categories.push(cat);
      this.newAsset.category = cat;
      this.newCategoryName = '';
      this.saveData();
      alert(`Kategori "${cat}" berjaya ditambah!`);
    },

    addSingleAsset() {
      if (!this.newAsset.tag.trim()) {
        alert('Sila masukkan Asset ID / Tagging!');
        return;
      }

      this.phones.push({
        tag: this.newAsset.tag.trim(),
        category: this.newAsset.category,
        model: this.newAsset.model.trim() || '-',
        level: this.newAsset.level.trim() || 'GF',
        location: this.newAsset.location.trim() || 'Unspecified',
        desc: this.newAsset.desc.trim() || '-',
        ip: this.newAsset.ip.trim() || '-',

        cctvPhysical: '',
        picQuality: '',
        viewFocus: '',
        recording: '',
        playback: '',
        ptzVolt: '',
        ptzPattern: '',

        magLock: '',
        readerIn: '',
        readerOut: '',
        pushBtn: '',
        breakGlass: '',
        doorSensor: '',
        keySwitch: '',

        physicalCheck: '',
        callIn: '',
        callOut: '',

        remarks: ''
      });

      this.saveData();
      this.newAsset.tag = '';
      this.newAsset.model = '';
      this.newAsset.location = '';
      this.newAsset.ip = '';
      alert('Aset berjaya disimpan ke awan!');
    },

    deleteAsset(index) {
      if (confirm('Padam aset ini daripada rekod?')) {
        this.phones.splice(index, 1);
        this.saveData();
      }
    },

    get phonePages() {
      const pageSize = 20;
      const pages = [];
      const list = this.reportAssets;
      for (let i = 0; i < list.length; i += pageSize) {
        pages.push(list.slice(i, i + pageSize));
      }
      return pages.length ? pages : [[]];
    },

    handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          
          let addedCount = 0;
          let updatedCount = 0;

          const assetMap = new Map();
          this.phones.forEach(item => {
            if (item.tag) {
              assetMap.set(String(item.tag).trim().toUpperCase(), item);
            }
          });

          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            if (!rawRows || rawRows.length === 0) return;

            let headerRowIndex = -1;
            for (let i = 0; i < Math.min(rawRows.length, 35); i++) {
              const rowStr = rawRows[i].map(c => String(c).trim().toLowerCase()).join(' ');
              if (
                rowStr.includes('new id') || 
                rowStr.includes('previous id') || 
                rowStr.includes('asset id') || 
                rowStr.includes('asset tagging') || 
                rowStr.includes('their asset')
              ) {
                headerRowIndex = i;
                break;
              }
            }

            if (headerRowIndex !== -1) {
              const headers = rawRows[headerRowIndex].map(h => String(h).trim().toLowerCase());

              for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
                const rowData = rawRows[r];
                if (!rowData || rowData.length === 0) continue;

                const row = {};
                headers.forEach((head, colIdx) => {
                  if (head) row[head] = rowData[colIdx] !== undefined ? String(rowData[colIdx]).trim() : '';
                });

                const rawTag = row['new id'] || row['previous id'] || row['asset id'] || row['their asset tagging'] || row['asset tag'] || row['tag'];
                if (!rawTag || String(rawTag).trim().length < 2) continue;

                const tag = String(rawTag).trim();
                const level = row['level'] || 'GF';
                const location = row['location'] || row['location on them'] || 'Unspecified';
                const ip = row['ip address'] || row['ip'] || '';

                let category = 'Access Control';
                const upperSheet = sheetName.toUpperCase();
                const upperTag = tag.toUpperCase();

                if (upperSheet.includes('CCTV') || upperTag.includes('CTV') || upperTag.includes('CAM')) {
                  category = 'CCTV Camera';
                } else if (upperSheet.includes('ACS') || upperTag.includes('ACS')) {
                  category = 'Access Control';
                } else if (upperTag.includes('TEL')) {
                  category = 'IP Phone';
                } else if (upperTag.includes('SW') || upperTag.includes('RTR')) {
                  category = 'Network Switch';
                }

                let model = '-';
                let desc = '-';

                if (category === 'CCTV Camera') {
                  model = row['device model'] || '-';
                  desc = row['type'] || row['device type'] || 'DOME';
                } else if (category === 'Access Control') {
                  model = row['device model'] || 'Access Door';
                  desc = row['device model'] || 'Access Door';
                } else {
                  model = row['device model'] || row['phone model'] || row['model'] || '-';
                  desc = row['description'] || 'IP PHONE';
                }

                if (category && !this.categories.includes(category)) {
                  this.categories.push(category);
                }

                const assetKey = tag.toUpperCase();
                const newAssetData = {
                  tag: tag,
                  category: category,
                  level: String(level).trim(),
                  location: String(location).trim(),
                  model: String(model).trim(),
                  desc: String(desc).trim(),
                  ip: String(ip).trim(),

                  cctvPhysical: '',
                  picQuality: '',
                  viewFocus: '',
                  recording: '',
                  playback: '',
                  ptzVolt: '',
                  ptzPattern: '',

                  magLock: '',
                  readerIn: '',
                  readerOut: '',
                  pushBtn: '',
                  breakGlass: '',
                  doorSensor: '',
                  keySwitch: '',

                  physicalCheck: '',
                  callIn: '',
                  callOut: '',

                  remarks: ''
                };

                if (assetMap.has(assetKey)) {
                  const existing = assetMap.get(assetKey);
                  Object.assign(existing, {
                    tag: newAssetData.tag,
                    category: newAssetData.category,
                    level: newAssetData.level,
                    location: newAssetData.location,
                    model: newAssetData.model,
                    desc: newAssetData.desc,
                    ip: newAssetData.ip,
                    remarks: ''
                  });
                  updatedCount++;
                } else {
                  assetMap.set(assetKey, newAssetData);
                  addedCount++;
                }
              }
            }
          });

          if (addedCount === 0 && updatedCount === 0) {
            alert('Tiada data aset baharu ditemui dalam fail ini.');
            return;
          }

          this.phones = Array.from(assetMap.values());
          this.saveData();

          alert(`Berjaya memproses fail!\n• Tab Diproses: ${workbook.SheetNames.join(', ')}\n• Ditambah: ${addedCount} unit\n• Dikemaskini: ${updatedCount} unit\n• Disimpan ke Cloud Firestore.`);
          event.target.value = '';
        } catch (err) {
          console.error(err);
          alert('Ralat membaca fail Excel: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    },

    async clearAll() {
      if (confirm('Padam semua rekod aset daripada Cloud Database?')) {
        this.phones = [];
        await this.saveData();
      }
    },

    printChecklist() {
      window.print();
    },

    async downloadDocxChecklist() {
      if (typeof docx === 'undefined') {
        alert('Library docx sedang dimuatkan.');
        return;
      }

      const {
        Document, Packer, Paragraph, Table, TableRow, TableCell,
        TextRun, WidthType, BorderStyle, AlignmentType,
        PageOrientation, Header, Footer, ImageRun, VerticalAlign
      } = docx;

      const fetchImageBuffer = async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.arrayBuffer();
        } catch (e) {
          return null;
        }
      };

      const [logoSkaBuf, logoMrtsBuf, logoIjmBuf] = await Promise.all([
        fetchImageBuffer('logo_ska.png'),
        fetchImageBuffer('logo_mrts.png'),
        fetchImageBuffer('logo_ijm.png')
      ]);

      const blackBorder = {
        top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "000000" }
      };

      const dashedBorder = {
        top: { style: BorderStyle.DASHED, size: 4, color: "666666" },
        bottom: { style: BorderStyle.DASHED, size: 4, color: "666666" },
        left: { style: BorderStyle.DASHED, size: 4, color: "666666" },
        right: { style: BorderStyle.DASHED, size: 4, color: "666666" }
      };

      const isCCTV = this.selectedReportType === 'CCTV';
      const isACS = this.selectedReportType === 'ACS';

      let activeHeaders = [];
      let docTitle = "";

      if (isCCTV) {
        docTitle = "CCTV SYSTEM (INTERNAL BUILDING)";
        activeHeaders = ["NO", "ASSET ID", "LEVEL", "LOCATION", "DEVICE TYPE", "IP ADDRESS", "PHYSICAL CHECK", "PICTURE QUALITY", "CAMERA VIEW FOCUS", "RECORDING", "PLAYBACK", "PTZ VOLTAGE", "PTZ PRESET & PATTERN", "REMARKS"];
      } else if (isACS) {
        docTitle = "ELECTRONIC ACCESS CARD SYSTEM";
        activeHeaders = ["NO", "ASSET ID", "LOCATION", "LEVEL", "MAGNETIC LOCK", "READER (IN)", "READER (OUT)", "EXIT PUSH BUTTON", "BREAK GLASS", "DOOR SENSOR", "KEY SWITCH", "REMARKS"];
      } else {
        docTitle = "IP PABX SYSTEM & IP PHONE";
        activeHeaders = ["NO", "ASSET ID", "LEVEL", "LOCATION", "MODEL", "DESCRIPTION", "IP ADDRESS", "PHYSICAL CHECK", "CALL IN", "CALL OUT", "REMARKS"];
      }

      const headerRow = new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: activeHeaders.map(text => new TableCell({
          borders: blackBorder,
          shading: { fill: "009be3" },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text, bold: true, size: 13 })] })]
        }))
      });

      const dataRows = this.reportAssets.map((ph, idx) => {
        const bg = (idx % 2 === 1) ? "ecf7fe" : "dcf2fd";
        let cells = [];

        if (isCCTV) {
          cells = [
            String(idx + 1), ph.tag || "", ph.level || "", ph.location || "",
            ph.desc || "DOME", ph.ip || "",
            ph.cctvPhysical || "", ph.picQuality || "", ph.viewFocus || "",
            ph.recording || "", ph.playback || "", ph.ptzVolt || "",
            ph.ptzPattern || "", ""
          ];
        } else if (isACS) {
          cells = [
            String(idx + 1), ph.tag || "", ph.location || "", ph.level || "",
            ph.magLock || "", ph.readerIn || "", ph.readerOut || "",
            ph.pushBtn || "", ph.breakGlass || "", ph.doorSensor || "",
            ph.keySwitch || "", ""
          ];
        } else {
          cells = [
            String(idx + 1), ph.tag || "", ph.level || "", ph.location || "",
            ph.model || "", ph.desc || "", ph.ip || "",
            ph.physicalCheck || "", ph.callIn || "", ph.callOut || "", ""
          ];
        }

        return new TableRow({
          cantSplit: true,
          children: cells.map((txt, cIdx) => new TableCell({
            borders: blackBorder,
            shading: { fill: bg },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: (cIdx === 0 || (isCCTV ? (cIdx === 2 || cIdx >= 6) : (cIdx === 3 || cIdx >= 4))) ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [new TextRun({ text: txt, size: 12, bold: cIdx === 1 })]
            })]
          }))
        });
      });

      const headerTable = new Table({
        rows: [new TableRow({
          children: [
            new TableCell({
              borders: dashedBorder,
              width: { size: 2000, type: WidthType.DXA },
              children: [logoSkaBuf ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: logoSkaBuf, transformation: { width: 95, height: 50 } })] }) : new Paragraph("SKA")]
            }),
            new TableCell({
              borders: dashedBorder,
              width: { size: 10800, type: WidthType.DXA },
              children: [
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "SKA TECHNOLOGY SDN. BHD. (552680-M)", bold: true, size: 17 })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "No. 26, Jalan Siput Akek, Taman Billion, Cheras, 56000 Kuala Lumpur", size: 13 })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Tel: 603-9130 5371, 9131 5371 | Email: skatech@skatech.com.my", size: 13 })] })
              ]
            }),
            new TableCell({
              borders: dashedBorder,
              width: { size: 2600, type: WidthType.DXA },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  ...(logoMrtsBuf ? [new ImageRun({ data: logoMrtsBuf, transformation: { width: 65, height: 32 } })] : []),
                  ...(logoIjmBuf ? [new ImageRun({ data: logoIjmBuf, transformation: { width: 35, height: 32 } })] : [])
                ]
              })]
            })
          ]
        })],
        width: { size: 100, type: WidthType.PERCENTAGE }
      });

      const footerTable = new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: "SKA Technology Sdn. Bhd.", bold: true, size: 13 })] })] }),
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: `Title: ${this.footerTitle} / ${this.monthYear}`, size: 13 })] })] }),
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: "Tested by (Signature & Name):", size: 13 })] })] }),
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: `Date: ${this.currentDate}`, size: 13 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: "Project Reference:", size: 13 })] })] }),
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: this.footerProjectName, bold: true, size: 13 })] })] }),
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: "Witness by (Signature & Name):", size: 13 })] })] }),
              new TableCell({ borders: blackBorder, children: [new Paragraph({ children: [new TextRun({ text: "Status: Verified", size: 13 })] })] })
            ]
          })
        ],
        width: { size: 100, type: WidthType.PERCENTAGE }
      });

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              size: { orientation: PageOrientation.LANDSCAPE },
              margin: { top: 720, bottom: 720, left: 720, right: 720 }
            }
          },
          headers: { default: new Header({ children: [headerTable] }) },
          footers: { default: new Footer({ children: [footerTable] }) },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `PREVENTIVE MAINTENANCE: ${this.projectName}`, bold: true, size: 22 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `MAINTENANCE CHECKLIST (${this.monthYear})`, bold: true, size: 18 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: docTitle, bold: true, size: 18 })] }),
            new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
            new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: "NOTES AND DISCREPANCIES:", bold: true, size: 15 })] }),
            new Paragraph({ children: [new TextRun({ text: this.notesDiscrepancies, size: 14 })] })
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `PPM_Checklist_${this.selectedReportType}_${this.monthYear.replace(/\s+/g, '_')}.docx`);
    }
  }));
});