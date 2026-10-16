from datetime import datetime, timezone
import io
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from timeline_file_sources.connectors import ConnectorPool, safe_remote_path


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.pool=ConnectorPool(self.root/'cache')
    def tearDown(self):self.temp.cleanup()

    def test_s3_paginates_downloads_changes_and_reuses_metadata_after_restart(self):
        source={'type':'s3','bucket':'example','prefix':'logs','format':'timeline_json','poll_seconds':0}
        client=MagicMock();session=MagicMock();session.client.return_value=client
        obj={'Key':'logs/day/file.json','ETag':'"one"','Size':2,'LastModified':datetime(2026,10,13,tzinfo=timezone.utc)}
        client.get_paginator.return_value.paginate.return_value=[{}, {'Contents':[obj]}]
        client.get_object.side_effect=lambda **kw:{'Body':io.BytesIO(b'{}')}
        with patch.dict('sys.modules',{'boto3':SimpleNamespace(Session=lambda **kw:session),
                     'botocore.config':SimpleNamespace(Config=lambda **kw:kw)}):
            root,files=self.pool.prepare(source)
            self.assertEqual(files,[root/'day/file.json']);self.assertEqual(files[0].read_bytes(),b'{}')
            self.assertEqual(client.get_object.call_count,1)
            self.assertEqual(client.get_object.call_args.kwargs['IfMatch'],'"one"')
            ConnectorPool(self.root/'cache').prepare(source)
            self.assertEqual(client.get_object.call_count,1)
            obj['ETag']='"two"';self.pool.prepare(source)
            self.assertEqual(client.get_object.call_count,2)
            client.get_paginator.return_value.paginate.return_value=[{'Contents':[]}]
            self.assertEqual(self.pool.prepare(source)[1],[])
            self.assertFalse((root/'day/file.json').exists())

    def test_sftp_validates_host_and_skips_unchanged_files(self):
        source={'type':'sftp','host':'host','username':'test','source_path':'/logs',
                'poll_seconds':0,'known_hosts':'known_hosts'}
        client=MagicMock();remote=MagicMock();client.open_sftp.return_value.__enter__.return_value=remote
        entry=SimpleNamespace(filename='event.json',st_mode=stat.S_IFREG,st_size=2,st_mtime=100)
        remote.listdir_attr.return_value=[entry];remote.stat.return_value=entry
        remote.open.return_value.__enter__.side_effect=lambda:io.BytesIO(b'{}')
        with patch.dict('sys.modules',{'paramiko':SimpleNamespace(SSHClient=lambda:client)}):
            root,files=self.pool.prepare(source)
            self.assertEqual(files[0].read_bytes(),b'{}')
            client.load_system_host_keys.assert_called_once();client.load_host_keys.assert_called_once_with('known_hosts')
            client.set_missing_host_key_policy.assert_not_called()
            self.pool.prepare(source)
            self.assertEqual(remote.open.call_count,1)
            entry.st_mtime=101;self.pool.prepare(source)
            self.assertEqual(remote.open.call_count,2)

    def test_oracle_incremental_watermark_ties_and_updated_rows(self):
        source={'type':'oracle','dsn':'example','user':'reader','poll_seconds':0,'initial_watermark':0,
                'query':'select ID, UPDATED, START_TIME, TITLE from EVENTS where UPDATED >= :watermark',
                'key_column':'ID','watermark_column':'UPDATED',
                'field_mapping':{'id':'ID','start':'START_TIME','data.title':'TITLE'}}
        connection=MagicMock();cursor=MagicMock()
        connection.__enter__.return_value=connection;connection.cursor.return_value.__enter__.return_value=cursor
        cursor.description=[('ID',),('UPDATED',),('START_TIME',),('TITLE',)]
        cursor.__iter__.return_value=iter([('first',1,datetime(2026,10,13,10,0),'Initial')])
        with patch.dict('sys.modules',{'oracledb':SimpleNamespace(connect=lambda **kw:connection)}):
            root,files=self.pool.prepare(source)
            first=json.loads(files[0].read_text());self.assertEqual(first[0]['data']['title'],'Initial')
            cursor.__iter__.return_value=iter([('first',2,datetime(2026,10,13,10,0),'Updated'),
                                              ('second',2,datetime(2026,10,13,11,0),'Second')])
            self.pool.prepare(source)
            self.assertEqual(cursor.execute.call_args.args[1]['watermark'],1)
            second=json.loads(files[0].read_text());self.assertEqual(len(second),2)
            self.assertEqual(second[0]['data']['title'],'Updated')
            # Inclusive boundary retrieves a late row with the same watermark.
            cursor.__iter__.return_value=iter([('third',2,datetime(2026,10,13,12,0),'Third')])
            ConnectorPool(self.root/'cache').prepare(source)
            self.assertEqual(cursor.execute.call_args.args[1]['watermark'],2)
            self.assertEqual(len(json.loads(files[0].read_text())),3)

    def test_oracle_invalid_row_does_not_advance_checkpoint(self):
        source={'type':'oracle','dsn':'example','user':'reader','poll_seconds':0,'initial_watermark':0,
                'query':'select ID, UPDATED, START_TIME, TITLE from EVENTS where UPDATED >= :watermark',
                'key_column':'ID','watermark_column':'UPDATED',
                'field_mapping':{'id':'ID','start':'START_TIME','data.title':'TITLE'}}
        connection=MagicMock();cursor=MagicMock();connection.__enter__.return_value=connection
        connection.cursor.return_value.__enter__.return_value=cursor
        cursor.description=[('ID',),('UPDATED',),('START_TIME',),('TITLE',)]
        cursor.__iter__.return_value=iter([('first',8,None,'Invalid')])
        with patch.dict('sys.modules',{'oracledb':SimpleNamespace(connect=lambda **kw:connection)}):
            with self.assertRaises(ValueError):self.pool.prepare(source)
        self.assertFalse(list((self.root/'cache').rglob('manifest.json')))

    def test_remote_paths_cannot_escape_cache(self):
        for name in ['../outside','/absolute','C:/outside','dir\\outside','dir/../../outside']:
            with self.assertRaises(ValueError):safe_remote_path(self.root,name)


if __name__=='__main__':unittest.main()
