const express = require('express');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); // CORS প্যাকেজ যোগ করুন
const app = express();
const port = process.env.PORT || 3000; // হোস্টিং প্ল্যাটফর্মের জন্য PORT পরিবর্তন করা হয়েছে

// CORS middleware ব্যবহার করুন
// এটি আপনার অ্যাপকে যেকোনো ডোমেইন থেকে রিকোয়েস্ট করার অনুমতি দেবে
app.use(cors());

app.use(express.json());

// 'downloads' ডিরেক্টরি তৈরি করুন যদি এটি না থাকে
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// ডাউনলোড করা ভিডিও ফাইলগুলো পরিবেশন করার জন্য
app.use('/downloads', express.static(downloadsDir));

// ডাউনলোড პროგრეს ট্র্যাক করার জন্য
const downloadProgress = {};

// মূল অ্যাপের ফাইল পরিবেশন করার জন্য (এখন আর প্রয়োজন নেই, কারণ ফ্রন্টএন্ড আলাদা)
// তবে এটি ব্রাউজারে টেস্ট করার জন্য রাখতে পারেন
app.get('/', (req, res) => {
    res.send('Video Downloader Server is running. Frontend is separate.');
});


// ভিডিওর তথ্য পেতে এবং ডাউনলোড শুরু করতে
app.post('/download', async (req, res) => {
    const { url } = req.body;
    if (!ytdl.validateURL(url)) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    try {
        const info = await ytdl.getInfo(url);
        const videoId = info.videoDetails.videoId;
        const videoTitle = info.videoDetails.title.replace(/[^\w\s.-]/g, ''); // ফাইলের নামের জন্য টাইটেল স্যানিটাইজ করা
        const filename = `${videoTitle} [${videoId}].mp4`;
        const filepath = path.join(downloadsDir, filename);

        // যদি ভিডিও আগে থেকেই ডাউনলোড করা থাকে
        if (fs.existsSync(filepath)) {
             return res.json({
                id: videoId,
                title: info.videoDetails.title,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
                status: 'completed',
                filePath: `/downloads/${encodeURIComponent(filename)}`
            });
        }

        const videoStream = ytdl(url, { quality: 'highest' });
        
        // პროგრეს ট্র্যাকিং শুরু
        downloadProgress[videoId] = {
            progress: 0,
            totalSize: 0,
            downloaded: 0,
            status: 'downloading'
        };

        videoStream.on('response', (response) => {
            downloadProgress[videoId].totalSize = parseInt(response.headers['content-length'], 10);
        });
        
        videoStream.on('progress', (chunkLength, downloaded, total) => {
            const progress = (downloaded / total) * 100;
            downloadProgress[videoId].progress = progress;
            downloadProgress[videoId].downloaded = downloaded;
        });

        const fileStream = fs.createWriteStream(filepath);
        videoStream.pipe(fileStream);

        fileStream.on('finish', () => {
            downloadProgress[videoId].status = 'completed';
            downloadProgress[videoId].progress = 100;
        });

        fileStream.on('error', (err) => {
            console.error('Error downloading video:', err);
            downloadProgress[videoId].status = 'failed';
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        });

        res.json({
            id: videoId,
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
            status: 'downloading',
            filePath: `/downloads/${encodeURIComponent(filename)}`
        });

    } catch (error) {
        console.error('Error getting video info:', error);
        res.status(500).json({ error: 'Failed to fetch video information.' });
    }
});

// SSE პროგრეს আপডেটের জন্য
app.get('/progress/:id', (req, res) => {
    const videoId = req.params.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = setInterval(() => {
        const progressData = downloadProgress[videoId];
        if (progressData) {
            res.write(`data: ${JSON.stringify(progressData)}\n\n`);
            if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(sendProgress);
                res.end();
            }
        }
    }, 1000);

    req.on('close', () => {
        clearInterval(sendProgress);
        res.end();
    });
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
