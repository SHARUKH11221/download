const express = require('express');
// লাইব্রেরি পরিবর্তন করা হয়েছে: ytdl-core এর বদলে @distube/ytdl-core
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

app.use('/downloads', express.static(downloadsDir));

const downloadProgress = {};

app.get('/', (req, res) => {
    res.status(200).send('Video Downloader Server is running. Frontend is separate.');
});

app.post('/download', async (req, res) => {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
        return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
    }

    try {
        console.log(`Fetching info for URL: ${url}`);
        
        // কুকিজ ব্যবহার করে ব্লকিং এড়ানোর চেষ্টা (এটি ঐচ্ছিক, তবে কার্যকরী)
        const agentOptions = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            }
        };

        const info = await ytdl.getInfo(url, { requestOptions: agentOptions });
        const videoId = info.videoDetails.videoId;
        const videoTitle = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'video';
        const filename = `${videoTitle} [${videoId}].mp4`;
        const filepath = path.join(downloadsDir, filename);

        if (fs.existsSync(filepath)) {
            console.log(`Video already downloaded: ${filename}`);
            return res.status(200).json({
                success: true,
                id: videoId,
                title: info.videoDetails.title,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails.pop().url,
                status: 'completed',
                filePath: `/downloads/${encodeURIComponent(filename)}`
            });
        }

        console.log(`Starting download for: ${info.videoDetails.title}`);

        const videoStream = ytdl(url, {
            quality: 'highest',
            filter: 'videoandaudio',
            requestOptions: agentOptions
        });

        downloadProgress[videoId] = {
            progress: 0,
            totalSize: 0,
            downloaded: 0,
            status: 'downloading'
        };

        videoStream.on('response', (response) => {
            const contentLength = response.headers['content-length'];
            if (contentLength) {
                downloadProgress[videoId].totalSize = parseInt(contentLength, 10);
            }
        });

        videoStream.on('progress', (chunkLength, downloaded, total) => {
            if (total > 0) {
                downloadProgress[videoId].progress = (downloaded / total) * 100;
            }
            downloadProgress[videoId].downloaded = downloaded;
        });

        const fileStream = fs.createWriteStream(filepath);
        videoStream.pipe(fileStream);

        fileStream.on('finish', () => {
            console.log(`Finished downloading: ${filename}`);
            downloadProgress[videoId].status = 'completed';
            downloadProgress[videoId].progress = 100;
        });

        fileStream.on('error', (err) => {
            console.error(`Error writing file:`, err);
            downloadProgress[videoId].status = 'failed';
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        });

        return res.status(200).json({
            success: true,
            id: videoId,
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            thumbnail: info.videoDetails.thumbnails.pop().url,
            status: 'downloading',
            filePath: `/downloads/${encodeURIComponent(filename)}`
        });

    } catch (error) {
        console.error('Detailed Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'YouTube blocked the server IP. Try deploying to a different region or check back later.' 
        });
    }
});

app.get('/progress/:id', (req, res) => {
    const videoId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const intervalId = setInterval(() => {
        const progressData = downloadProgress[videoId];
        if (progressData) {
            res.write(`data: ${JSON.stringify(progressData)}\n\n`);
            if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(intervalId);
                res.end();
            }
        }
    }, 1000);

    req.on('close', () => {
        clearInterval(intervalId);
        res.end();
    });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
